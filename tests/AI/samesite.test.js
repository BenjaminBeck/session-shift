import { describe, expect, it } from 'vitest'
import { parseSetCookie, parseDocumentCookie, serializeCookieHeader } from '../lib/cookie-parser.js'
import { buildDnrRulesForCookieStore } from '../background/dnr-cookie-rule-builder.js'

const store = {
  strict: { name: 'strict', value: '1', domain: 'example.com', sameSite: 'Strict', path: '/' },
  lax: { name: 'lax', value: '1', domain: 'example.com', sameSite: 'Lax', path: '/' },
  legacy: { name: 'legacy', value: '1', domain: 'example.com', path: '/' },
  none: { name: 'none', value: '1', domain: 'example.com', sameSite: 'None', secure: true, path: '/' },
}

describe('network cookie attributes', () => {
  it('allows only explicit Secure None in cross-site requests', () => {
    expect(serializeCookieHeader(store, { sameSiteContext: 'cross-site' })).toBe('none=1')
  })
  it('allows Lax and legacy cookies on a safe top-level navigation', () => {
    expect(serializeCookieHeader(store, { sameSiteContext: 'top-level-safe' })).toBe('lax=1; legacy=1; none=1')
  })
  it('preserves same-site and document-cookie visibility independently', () => {
    expect(serializeCookieHeader(store, { sameSiteContext: 'same-site' })).toContain('strict=1')
    expect(serializeCookieHeader(store, { excludeHttpOnly: true })).toContain('strict=1')
  })
  it('rejects server None cookies without Secure', () => {
    expect(parseSetCookie('sid=x; SameSite=None', 'https://example.com')).toBeNull()
    expect(parseSetCookie('sid=x; SameSite=None; Secure', 'https://example.com').secure).toBe(true)
  })
  it('retains attributes written by document.cookie', () => {
    expect(parseDocumentCookie('sid=x; SameSite=Strict; Secure', 'https://example.com')).toMatchObject({ sameSite: 'Strict', secure: true })
  })
  it('never publishes Secure cookies into plaintext request rules, including before first navigation', () => {
    const rules = buildDnrRulesForCookieStore({ tabId: 1, ruleIds: Array.from({ length: 100 }, (_, i) => i + 1), store, boundHost: null, scheme: null, serializeOpts: {}, resourceTypes: ['main_frame', 'xmlhttprequest'] })
    const secureRules = rules.filter(r => r.action.requestHeaders?.[0]?.value?.includes('none=1'))
    expect(secureRules.length).toBeGreaterThan(0)
    expect(secureRules.every(r => r.condition.regexFilter.startsWith('^https://'))).toBe(true)
  })
  it('rejects rule-budget overflow instead of publishing a partial cookie policy', () => {
    expect(() => buildDnrRulesForCookieStore({ tabId: 1, ruleIds: [1, 2, 3], store, boundHost: null, scheme: 'https', serializeOpts: {}, resourceTypes: ['main_frame'] })).toThrow('budget exhausted')
  })
})
