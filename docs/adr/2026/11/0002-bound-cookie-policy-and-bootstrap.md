---
id: ADR-0002
title: Preserve cookie attributes without claiming native browser isolation
status: proposed
date: 2026-11-11
deciders: []
provenance: agent-made
supersedes: null
superseded-by: null
tags: [security, cookies, compatibility]
---

# Preserve cookie attributes without claiming native browser isolation

## Context

The original fork discards SameSite after parsing and sets complete Cookie headers
through DNR. It also initializes MAIN-world API proxies asynchronously. A page can
capture a native storage API before the handshake finishes. The page-visible nonce
is not an authorization boundary.

## Decision

**Retain Secure/SameSite and constrain network cookie headers by request scheme and
site context, but keep incomplete native semantics and the bootstrap gap explicit.**
Use Chrome's sending frame as cookie-write authority. Treat missing SameSite as
Lax; cross-site subresources/unsafe requests only receive Secure None cookies;
safe top-level GET/HEAD also receive Lax. First-party variants require initiator
and top-frame domains, hence Chrome 145+. Secure cookies use HTTPS-only rules,
including the first request from about:blank. Publish no partial rule set when the
per-tab rule budget is exhausted.

## Options considered

- **Context-sensitive DNR headers (chosen as a bounded improvement):** eliminates
  unrestricted cross-site header injection in the tested cases while supporting
  ordinary cookie logins. DNR domain matching and asynchronously observed tab
  schemes are not a complete native schemeful SameSite algorithm, especially
  across scheme changes, redirect chains and mixed ancestor chains. Fetch
  credentials mode and partitioned-cookie semantics remain incomplete.
- **Always send all cookies:** compatible with more sites but ignores server cookie
  restrictions; rejected.
- **Suppress all Strict/Lax cookies except top-level safe requests:** conservative,
  but breaks same-site authenticated XHR and POST workflows.
- **Synchronously throw from storage/XHR/cookie APIs before the handshake:** tried
  and removed. At document_start the MAIN world does not yet know the profile, so
  this would break ordinary websites as well as profile tabs. Returning invented
  empty state would silently change application behavior instead.
- **Separate browser profiles/contexts:** provides native isolation but requires
  a different architecture and cannot be implemented as a transparent per-tab
  extension patch.

## Consequences

This is an improvement to cookie handling, not a complete fix for all browser
security semantics. Early MAIN-world API capture remains unresolved. Do not use
this build to certify SameSite/CSRF defenses or as isolation against hostile pages.
A complete startup fix requires changing the loading model (controlled bootstrap
or isolated browser contexts) and revisiting the universal compatibility constraint.

## Consultation

The user requested source fixes, separate commits, and universal website support.
The compatibility-breaking provisional synchronous guard was removed by the agent;
no claim is made that the startup issue was corrected. Remaining work is recorded
in docs/security-review.md for an informed follow-up decision.
