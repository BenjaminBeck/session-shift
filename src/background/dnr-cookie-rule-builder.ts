import { serializeCookieHeader, normalizeCookiePath, type SerializeOptions } from '../lib/cookie-parser.js';
import type { CookieStoreEntry } from '../lib/session-store.js';
import type { DNRRule } from '../lib/types.js';
import { getEtld1 } from '../lib/public-suffix.js';

/**
 * Server-Timing entry DNR appends to a held redirect, so the content script can
 * tell it apart from a genuine 3xx document synchronously (content.ts mirrors it).
 */
export const HELD_REDIRECT_MARKER = 'sessionshift-held';

type CookieRuleScope = {
  type: 'host' | 'domain'
  host: string
  path: string
}

type BuildRuleOptions = {
  tabId: number
  ruleIds: number[]
  boundHost: string | null
  scheme: 'https' | 'http' | null
  store: Record<string, CookieStoreEntry>
  serializeOpts: SerializeOptions
  resourceTypes: chrome.declarativeNetRequest.ResourceType[]
  firstPartyDomain?: string | null
  requestStripResourceTypes?: chrome.declarativeNetRequest.ResourceType[]
  responseStripResourceTypes?: chrome.declarativeNetRequest.ResourceType[]
}

function normalizeStoredDomain(domain: string | null | undefined, boundHost: string | null): string | null {
  return (domain ?? boundHost)?.replace(/\.$/, '').toLowerCase() ?? null;
}

function pathFilterSuffix(path: string): string {
  if (path === '/') return '/';
  return path.endsWith('/') ? path : `${path}^`;
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function exactHostRegexFilter(scheme: 'https' | 'http', host: string, path: string): string {
  const hostPattern = escapeRegex(host);
  if (path === '/') return `^${scheme}://${hostPattern}(?::[0-9]+)?/`;
  const pathPattern = escapeRegex(path);
  return `^${scheme}://${hostPattern}(?::[0-9]+)?${pathPattern}(?:[/?#]|$)`;
}

function domainUrlFilter(scheme: 'https' | 'http', path: string): string {
  if (path === '/') return `|${scheme}://`;
  return `|${scheme}://*${pathFilterSuffix(path)}`;
}

function addPath(pathsByHost: Map<string, Set<string>>, host: string, path: string): void {
  pathsByHost.set(host, (pathsByHost.get(host) ?? new Set()).add(path));
}

function buildCookieRuleScopes(store: Record<string, CookieStoreEntry>, boundHost: string | null): CookieRuleScope[] {
  const exactHosts = new Set<string>();
  const pathsByHost = new Map<string, Set<string>>();
  const pathsByDomain = new Map<string, Set<string>>();

  if (boundHost) exactHosts.add(boundHost.toLowerCase());

  for (const entry of Object.values(store)) {
    const domain = normalizeStoredDomain(entry.domain, boundHost);
    if (!domain) continue;
    const path = normalizeCookiePath(entry.path);
    const domainWithoutDot = domain.replace(/^\./, '');

    if (domain.startsWith('.')) {
      addPath(pathsByDomain, domainWithoutDot, path);
      for (const host of exactHosts) {
        if (host === domainWithoutDot || host.endsWith('.' + domainWithoutDot)) addPath(pathsByHost, host, path);
      }
    } else {
      exactHosts.add(domain);
      addPath(pathsByHost, domain, path);
    }
  }

  for (const host of exactHosts) {
    for (const [domain, paths] of pathsByDomain) {
      if (host === domain || host.endsWith('.' + domain)) {
        for (const path of paths) addPath(pathsByHost, host, path);
      }
    }
  }

  const scopes: CookieRuleScope[] = [];
  for (const [host, paths] of pathsByHost) {
    for (const path of paths) scopes.push({ type: 'host', host, path });
  }
  for (const [host, paths] of pathsByDomain) {
    for (const path of paths) scopes.push({ type: 'domain', host, path });
  }
  // Deterministic ordering; an exhausted budget rejects the entire publication.
  return scopes.sort((left, right) =>
    left.path.length - right.path.length ||
    (left.type === right.type ? left.host.localeCompare(right.host) : left.type === 'host' ? -1 : 1)
  );
}

// Bound-host-scoped condition: matches only requests to the session's eTLD+1.
function boundHostCondition(
  boundHost: string,
  scheme: 'https' | 'http' | null,
  resourceTypes: chrome.declarativeNetRequest.ResourceType[]
): chrome.declarativeNetRequest.RuleCondition {
  if (scheme) {
    return { urlFilter: `|${scheme}://`, requestDomains: [getEtld1(boundHost)], resourceTypes };
  }
  return { requestDomains: [getEtld1(boundHost)], resourceTypes };
}

// Request-side `Cookie: remove` condition.
// For global profiles this is tab-scoped, all schemes, no requestDomains. An
// http/ws subresource in an https-bound tab must also be stripped or the default
// jar leaks.
function buildRequestStripCondition(
  boundHost: string | null,
  scheme: 'https' | 'http' | null,
  resourceTypes: chrome.declarativeNetRequest.ResourceType[],
  firstPartyDomain: string | null | undefined
): chrome.declarativeNetRequest.RuleCondition {
  if (!boundHost) {
    void firstPartyDomain;
    return { resourceTypes };
  }
  return boundHostCondition(boundHost, scheme, resourceTypes);
}

// Response-side `set-cookie: remove` condition. The caller controls resource
// types because top-level navigation redirects need Chrome's jar write to happen
// before the redirected request is sent.
function buildResponseStripCondition(
  boundHost: string | null,
  scheme: 'https' | 'http' | null,
  resourceTypes: chrome.declarativeNetRequest.ResourceType[]
): chrome.declarativeNetRequest.RuleCondition {
  if (!boundHost) {
    return { resourceTypes };
  }
  return boundHostCondition(boundHost, scheme, resourceTypes);
}

function buildCookieCondition(
  scope: CookieRuleScope,
  scheme: 'https' | 'http' | null,
  resourceTypes: chrome.declarativeNetRequest.ResourceType[]
): chrome.declarativeNetRequest.RuleCondition {
  if (scheme && scope.type === 'host') {
    return { regexFilter: exactHostRegexFilter(scheme, scope.host, scope.path), resourceTypes };
  }
  if (scheme) {
    return {
      urlFilter: domainUrlFilter(scheme, scope.path),
      requestDomains: [scope.host],
      resourceTypes,
    };
  }
  return { requestDomains: [scope.host], resourceTypes };
}

export function buildDnrRulesForCookieStore(options: BuildRuleOptions): DNRRule[] {
  // Request and response strips are separate rules so each side can scope its
  // resource types independently. Both default to every type the tab uses,
  // navigations included: the tab's cookies come only from the `Cookie: set`
  // rules below, never from Chrome's shared jar, and never land in it.
  const requestStripResourceTypes = options.requestStripResourceTypes ?? options.resourceTypes;
  const requestCondition = buildRequestStripCondition(
    options.boundHost, options.scheme, requestStripResourceTypes, options.firstPartyDomain);
  requestCondition.tabIds = [options.tabId];
  const strictResponseResourceTypes = options.responseStripResourceTypes ?? options.resourceTypes;

  const addRules: DNRRule[] = [
    {
      id: options.ruleIds[0],
      priority: 100,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Cookie', operation: 'remove' }] },
      condition: requestCondition,
    },
  ];

  if (strictResponseResourceTypes.length > 0) {
    const responseCondition = buildResponseStripCondition(
      options.boundHost, options.scheme, strictResponseResourceTypes);
    responseCondition.tabIds = [options.tabId];
    addRules.push({
      id: options.ruleIds[addRules.length],
      priority: 100,
      action: { type: 'modifyHeaders', responseHeaders: [{ header: 'set-cookie', operation: 'remove' }] },
      condition: responseCondition,
    });
  }

  // Held redirects: a navigation response that sets cookies loses its Location,
  // so Chrome commits it instead of following it before those cookies are
  // captured; SessionShift finishes the hop (see held-redirects.ts). The
  // Server-Timing marker lets the content script stop only held documents.
  // `responseHeaders` conditions need Chrome 128 or newer.
  addRules.push({
    id: options.ruleIds[addRules.length],
    priority: 100,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'location', operation: 'remove' },
        { header: 'server-timing', operation: 'append', value: HELD_REDIRECT_MARKER },
      ],
    },
    condition: {
      tabIds: [options.tabId],
      resourceTypes: ['main_frame', 'sub_frame'],
      responseHeaders: [{ header: 'set-cookie' }],
    },
  });

  const scopes = buildCookieRuleScopes(options.store, options.boundHost);
  for (const scope of scopes) {
    for (const requestScheme of ['https', 'http'] as const) {
    // Emit a complete header for each context; appending individual cookies
    // would let Chrome combine headers across priorities. Missing SameSite is
    // treated conservatively as Lax (no two-minute POST exception).
    const requestUrl = `${requestScheme}://${scope.host}${scope.path}`;
    const base = buildCookieCondition(scope, requestScheme, options.resourceTypes);
    const site = getEtld1(scope.host);
    const variants: Array<{ context: 'cross-site' | 'top-level-safe' | 'same-site'; condition: chrome.declarativeNetRequest.RuleCondition }> = [
      { context: 'cross-site', condition: base },
    ];
    if ((options.resourceTypes as string[]).includes('main_frame')) {
      variants.push({ context: 'top-level-safe', condition: {
        ...base, resourceTypes: ['main_frame'], requestMethods: ['get', 'head'],
      } });
    }
    if (options.scheme === requestScheme) variants.push({ context: 'same-site', condition: {
      ...base, domainType: 'firstParty', initiatorDomains: [site], topDomains: [site],
    } });
    for (let variant = 0; variant < variants.length; variant++) {
      const { context, condition } = variants[variant];
      const cookieStr = serializeCookieHeader(options.store, {
        ...options.serializeOpts, excludeSecure: requestScheme !== 'https', requestUrl, sameSiteContext: context,
      });
      if (!cookieStr) continue;
      if (addRules.length >= options.ruleIds.length) {
        // Never publish a partial set: a missing longer-path rule could expose
        // a less restrictive shorter-path cookie. Fail closed at the caller.
        throw new Error(`Cookie rule budget exhausted for tab ${options.tabId}`);
      }
      addRules.push({
        id: options.ruleIds[addRules.length],
        priority: 100 + scope.path.length * 10 + (scope.type === 'host' ? 4 : 0) + variant,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Cookie', operation: 'set', value: cookieStr }] },
        condition: { ...condition, tabIds: [options.tabId] },
      });
    }
    }
  }

  return addRules;
}
