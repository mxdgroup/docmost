# MxD Docs analytics

Docs uses the MxD PostHog project (US project 142511), the managed browser proxy
`https://n.mxd.digital`, and Signal's signed identity handoff. Set `POSTHOG_KEY`
to Signal's **public project key**, `POSTHOG_HOST` to that proxy, and
`IDENTITY_PARAM_SECRET` to Signal's existing server secret. The secret is never
included in runtime browser configuration. Leaving the key/host unset disables
analytics without affecting the app. There are no database migrations.

## Identity and domain boundaries

The person identifier is `email.trim().toLowerCase()`; plus tags and dots remain.
A valid workspace session takes precedence, then a verified commenter session,
then a signed Signal handoff. Guest names are never treated as authenticated
identities. The endpoint returns only email, optional name and identity source;
it grants no session, membership or document permissions.

Signal sends `ph_distinct_id`, `ph_exp`, `ph_sig` with a five-minute expiry.
The signature is the first 32 hex characters of HMAC-SHA256 over
`<distinct_id>\n<expiry>`. Docs validates it server-side, rejects expired or
malformed values and expiries more than an hour ahead, redirects to the same
local path with all three parameters removed, and passes the verified values
through a 60-second, host-only HttpOnly cookie. `/api/analytics/identity` consumes
and revalidates that cookie. Unsigned values identify nobody. The SDK never
trusts URL parameters. Authenticated identities override link attribution.

Cookie persistence shares identity across `*.mxd.digital`; open Docs tabs
reconcile on focus/visibility changes. Different identified people trigger a
reset before identify; anonymous history merges forward. A logged-out or expired
Docs account is detached. Cross-domain profiles join through the same normalized
email or a signed handoff. Separate registrable domains and separate browsers
cannot share cookies: they need their existing sign-in or Signal handoff.
This integration does not add cross-domain application login or permissions.

The reference contract is `mxd-client_onboarding/docs/standards/posthog-identity.md`
and the signing implementation is `mxd-url-shortener/app/identity.py`. Signal's
`IDENTITY_COOKIE_DOMAINS=mxd.digital` also allows signed handoffs to Docs through
its inherited destination allowlist; no Signal deployment change is required.

## What is measured

Every event carries `surface=docs`, `environment`, a route category and area.
Page visits include the opaque page slug ID (`page_ref`) so activity can be
associated with a document without sending its title, share credential or URL.
Actions cover editing activity (once per 30 seconds), successful page mutations,
searches, comment changes, sharing changes and uploads. `docs_edit_started`
means local editing activity, not confirmation of a completed save.

Autocapture, session replay, heatmaps, performance/network capture, exceptions,
surveys and external SDK extensions are disabled. An event/property allowlist
in `before_send` filters SDK defaults, sibling-site persistence, top-level and
nested person properties. URLs become route templates; query strings, fragments,
share keys, titles, document/comment text, search terms and phone numbers are
excluded. Person properties are limited to email/name and first-seen surface.
`Referrer-Policy` protects cross-origin transport metadata, including on shares.

The shared `mxd_consent` cookie is read before identification and every capture.
`denied` stops measurement and discards handoffs; restoration synchronizes the
SDK's own opt-out flag. Docs never writes this cookie. MxD's website owns the
privacy preference at `https://mxd.digital/privacy/analytics`.

## Validation and rollback

Server tests cover Signal's pinned signature vector, tampering, expiry, duplicate
parameters, cookie/redirect behavior, consent, identity precedence and guard
errors. Client tests cover profile redaction, account switching, expired sessions
during withdrawal, competing refreshes, shared-cookie reconciliation, actions
and SDK initialization. Both suites run in the fork CI workflow.

After deploy, verify the proxy/project configuration, a signed handoff with the
query removed, rejected tampering, authenticated identity precedence, and pageview
payloads on a disposable document. Do not record production document bodies or
access tokens in test reports. PostHog events can be filtered by `surface=docs`
and `environment=production`, then inspected by person, event, and `page_ref`.

Disable capture by unsetting POSTHOG_KEY and recreating the app container. A
rollback from mxd.10 to mxd.9 is an image/config flip because no migrations were
added here; older migration-era rollback requirements remain in MXD-FORK.md.
