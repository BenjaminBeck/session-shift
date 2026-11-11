---
id: ADR-0001
title: Require an explicit role after a browser restart
status: proposed
date: 2026-11-11
deciders: []
provenance: agent-made
supersedes: null
superseded-by: null
tags: [security, sessions, lifecycle]
---

# Require an explicit role after a browser restart

## Context

Chrome clears storage.session and DNR session rules when the browser exits. Cookie
profiles in storage.local survive. Reopened tabs can therefore use Chrome's normal
account before the extension has recovered their identity. Several roles can use
exactly the same URL, so URL matching cannot recover the intended role safely.
The user explicitly requires universal website eligibility, rather than an allowlist
limited to the local test application.

## Decision

**Persist host guards as dynamic DNR rules and require a role selection when a tab
has no live assignment.** A GET navigation to a protected host goes to an extension
page; other requests, including POST, are blocked. A tab explicitly assigned to a
profile or the normal account receives a session-only exemption. Profile cookie
rules have higher priority than this exemption. Main-frame resources must be listed
explicitly: DNR's default resource types exclude them.

Hosts become protected when used through the extension and on committed profile
navigations. Existing normal tabs on a newly protected host retain their identity.
New tabs on an already protected host also need a selection. A linked tab with an
explicit live inherited assignment can resume after successful rule installation.
No URL/window/order-based role reconstruction is performed.

## Options considered

- **Durable guard and explicit selection (chosen):** works for any HTTP(S) site,
  prevents normal-account requests to known protected hosts after restart, and
  avoids role guessing. Adds an interaction for new tabs on those hosts; hosts stay
  protected after deleting their last profile. Dynamic rules apply only while the
  extension is enabled and permitted for the site.
- **URL/window/index matching:** convenient, but ambiguous for identical URLs and
  potentially selects a different privileged account. The older, unimplemented
  `docs/superpowers/specs/2026-04-06-session-persistence-design.md` is not the
  restoration policy implemented by this fork.
- **Restrict to approved test sites with an entry page:** narrower impact and easier
  to control loading, but the user rejected the site restriction.
- **Silently use Chrome's normal session:** maintains old behavior but fails the
  user's intent when testing multiple roles.

## Consequences

The chooser is not automatic session restoration. POST submissions are never
replayed by the guard. Unknown hosts and requests without a tab (e.g. worker
traffic) are not made into independent browser contexts. Website storage proxies
and the startup handshake still have limitations documented in security-review.md.
A browser extension cannot provide all the isolation guarantees of separate Chrome
profiles. Guard failures must be reported rather than described as full isolation.

## Consultation

The user authorized fixes and explicitly selected universal website support. The
specific durable-guard implementation is an agent proposal, covered by actual
Chrome tests including a full process restart, two roles on the same URL, and a
blocked POST before selection. It has not received a separate human code review.
