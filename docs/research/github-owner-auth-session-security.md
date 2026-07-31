# GitHub owner authentication and session security

Research for [Specify GitHub owner authentication and session security](https://github.com/alantothe/minimal-portfolio/issues/30), current through 2026-07-30.

## Decision

Use a dedicated GitHub OAuth App only to prove the Portfolio owner's identity. After GitHub returns the authenticated account, compare its immutable numeric user ID with one configured owner ID, delete the temporary GitHub access token, and create an application-owned opaque session stored in SQLite.

Do not use GitHub's access token as the Owner-workspace session. Do not authorize by login, email, organization membership, a secret URL, or possession of the existing GitHub activity token.

Protect the OAuth redirect with PKCE `S256` plus a one-use `state` value bound to the initiating browser. Protect every application mutation with an exact-origin check plus a session-bound CSRF token. All Owner-workspace HTML, assets, draft previews, and APIs sit behind one route guard and use `Cache-Control: no-store`.

## Current repository constraints

- [`requestHandler.ts`](../../src/server/core/requestHandler.ts) accepts only `GET`, `HEAD`, and `OPTIONS`. Production auth and content mutation require explicit method-aware routing for `POST`, `PUT`/`PATCH`, and `DELETE`.
- [`router.ts`](../../src/server/core/router.ts) receives a `URL`, not the original `Request`. Authentication needs the method, headers, cookies, and request body, so the router contract must carry `Request`.
- [`routes/index.ts`](../../src/server/routes/index.ts) has no private route group or middleware boundary.
- [`staticHandler.ts`](../../src/server/core/staticHandler.ts) serves `/public/*` before routing. Owner-workspace JavaScript must not be placed in that public tree unless the request handler gains a protected asset namespace.
- [`shell.html`](../../src/pages/shell.html) loads only Visitor navigation and display scripts. Keep it that way; public pages must not reference Owner-workspace bundles.
- Production already validates `SITE_URL` as the final HTTPS origin in [`seo.ts`](../../src/server/services/seo.ts). Authentication should reuse that parsed origin rather than trust `Host` or forwarding headers.
- The persistence decision chose SQLite at `/data/content.sqlite`; OAuth attempts and sessions belong in that database.

## Why a dedicated GitHub OAuth App

GitHub's web application flow implements the authorization-code grant, supports one-use `state`, and supports PKCE with `S256`. GitHub strongly recommends the exact redirect URI, `state`, `code_challenge`, and `code_verifier` parameters ([GitHub: Authorizing OAuth apps](https://docs.github.com/en/enterprise-cloud@latest/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)).

OAuth Security Best Current Practice recommends PKCE for confidential web clients, requires transaction-specific binding to the user agent, requires CSRF protection, and requires exact redirect matching ([RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1.1)).

Create a separate OAuth App for this portfolio:

- Homepage: the production `SITE_URL`.
- Authorization callback: exactly `${SITE_URL}/admin/auth/github/callback`.
- Device flow: disabled.
- No repository or organization integration.
- No requested scopes. The authenticated-user endpoint returns the public numeric `id` without the `user` scope; that scope is needed only for private profile fields ([GitHub: Get the authenticated user](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)).

GitHub can reuse scopes previously granted to the same OAuth App when a later authorization omits `scope`. A dedicated app must therefore never request broader scopes, and the callback must reject a token response whose returned `scope` is non-empty.

## Exact OAuth flow

### Start: `GET /admin/auth/github/start`

1. Generate three independent cryptographically random values:
   - `state`: 32 bytes, base64url encoded.
   - PKCE verifier: 32 bytes, base64url encoded (43 characters).
   - Browser-attempt token: 32 bytes, base64url encoded.
2. Compute the PKCE challenge as base64url-without-padding of `SHA-256(verifier)`.
3. Store one `oauth_attempts` row:
   - SHA-256 digest of browser-attempt token.
   - SHA-256 digest of `state`.
   - PKCE verifier.
   - `created_at`.
   - `expires_at = created_at + 10 minutes`.
   - nullable `consumed_at`.
4. Set the browser-attempt cookie:

   ```text
   Set-Cookie: __Host-owner_oauth=<attempt-token>; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax
   ```

5. Redirect to `https://github.com/login/oauth/authorize` with:
   - configured `client_id`;
   - exact callback `redirect_uri`;
   - empty `scope`;
   - random `state`;
   - PKCE `code_challenge`;
   - `code_challenge_method=S256`;
   - `allow_signup=false`;
   - `prompt=select_account`.

The `__Host-` prefix requires `Secure`, `Path=/`, and no `Domain`, keeping the cookie host-only ([Cookies: HTTP State Management Mechanism](https://www.rfc-editor.org/rfc/rfc10025.html), [MDN: Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#cookie_prefixes)).

### Callback: `GET /admin/auth/github/callback`

The callback response must use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, load no third-party resources, and never render the received `code` or `state`.

1. Require `code`, `state`, and the browser-attempt cookie.
2. In one transaction, find the matching unexpired attempt by both token digest and state digest, then mark it consumed. Reject missing, expired, mismatched, or previously consumed attempts.
3. Exchange the code server-to-server at GitHub's token endpoint using:
   - client ID;
   - sealed client secret;
   - exact redirect URI;
   - original PKCE verifier.
4. Require a bearer token response with an empty returned scope.
5. Call `GET https://api.github.com/user` with the token and current GitHub API version.
6. Require:

   ```text
   response.id === Number(GITHUB_OWNER_ID)
   ```

   GitHub's numeric `id` is the authorization identity. Login is display-only because account names can change.

7. Delete the temporary OAuth token through GitHub's “Delete an app token” endpoint before creating the application session ([GitHub: OAuth application endpoints](https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-token)). Do not delete the entire app grant.
8. Revoke any existing active V1 owner session, create a fresh application session, set its cookie, clear the attempt cookie, then return `303 See Other` to `/admin`.

If token deletion fails after a bounded retry, deny login and create no session. The application never needs continuing GitHub API access from this token.

## Owner allowlist

Configure exactly one decimal GitHub account ID:

```text
GITHUB_OWNER_ID=104442054
```

Treat the value as configuration, not a secret. Validate it as a positive safe integer at startup.

Never authorize using:

- `login === "alantothe"`;
- email address;
- avatar/profile data;
- repository ownership;
- organization/team membership;
- the existing `GITHUB_TOKEN`;
- route secrecy.

For an unapproved GitHub account, delete the temporary OAuth token, create no session, clear the attempt cookie, and return a generic `403`. Do not reveal which ID was expected.

## Application session design

Create a 32-byte random session token. Send the raw token only to the browser; store only its SHA-256 digest in SQLite.

Suggested `owner_sessions` fields:

- `token_digest` primary key;
- `github_user_id`;
- `csrf_token`;
- `created_at`;
- `last_seen_at`;
- `idle_expires_at`;
- `absolute_expires_at`;
- nullable `revoked_at`.

V1 allows one active session. Successful login revokes the previous one. This matches one Portfolio owner and desktop-first authoring while making account switching explicit.

Cookie:

```text
Set-Cookie: __Host-owner_session=<raw-token>; Path=/; Max-Age=43200; Secure; HttpOnly; SameSite=Lax
```

Server-enforced expiry:

- Idle timeout: 30 minutes.
- Absolute timeout: 12 hours.
- Update `last_seen_at` at most once every five minutes to avoid a write on every request.
- Expired/revoked sessions return unauthenticated and clear the cookie.
- Never extend `absolute_expires_at`.

`SameSite=Lax` reduces cross-site cookie sending without breaking a top-level navigation to the workspace. It is defense in depth, not the only CSRF control. `Secure` restricts transport to HTTPS and `HttpOnly` prevents browser scripts from reading the token ([RFC 6265](https://www.rfc-editor.org/rfc/rfc6265.html#section-4.1.2)).

Do not use a JWT. Server-side opaque sessions provide immediate logout/revocation, short database rows, and no signing-key lifecycle.

## Route boundary

Build one guard for:

- `/admin` and every nested HTML route;
- Owner-workspace CSS and JavaScript;
- `/admin/preview/*` and all Content-draft rendering;
- every owner read API;
- every owner mutation API.

Only these routes bypass an established application session:

- `/admin/login`;
- `/admin/auth/github/start`;
- `/admin/auth/github/callback`.

Response behavior:

- Unauthenticated Owner-workspace HTML: `303` to `/admin/login`.
- Unauthenticated owner API: JSON `401`.
- Authenticated request with invalid authorization state: `403`.
- Every private response: `Cache-Control: no-store`, `Vary: Cookie`, and `X-Robots-Tag: noindex, nofollow`.
- Draft preview: same private headers; never expose a public, bearer, or guessable preview URL.
- Public shell and public static assets: no Owner-workspace scripts, links, flags, or session-dependent rendering.

Admin assets should live behind the private route group, not below the current unconditional `/public` static path.

## CSRF design

No mutation may use `GET`. Extend the router to register allowed methods per route instead of globally enabling every method.

For each `POST`, `PUT`, `PATCH`, and `DELETE` under the Owner workspace:

1. Require a valid owner session.
2. Require `Origin` to exactly equal `new URL(SITE_URL).origin`; reject missing, `null`, or mismatched origins.
3. Require `X-CSRF-Token` to equal the random token stored with the session, using a constant-time comparison.
4. Require the expected content type and reject cross-origin CORS credentials.

Render the CSRF value only inside authenticated Owner-workspace HTML, then keep it in workspace JavaScript memory. It is not a cookie and never appears on public pages.

The OAuth callback uses its separate PKCE + one-use-state protection. RFC 9700 requires CSRF protection for redirect endpoints and describes `state` securely bound to the user agent; GitHub also documents state mismatch as an abort condition ([RFC 9700 §4.7](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.7), [GitHub OAuth flow](https://docs.github.com/en/enterprise-cloud@latest/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)).

## Logout and revocation

`POST /admin/logout` requires the normal session, exact-origin check, and CSRF token.

In one operation:

1. Mark the session revoked.
2. Clear the cookie with the same attributes and `Max-Age=0`.
3. Return `303` to `/admin/login`.

Closing a browser does not count as logout because the cookie is persistent for its 12-hour maximum. Expiry and login replacement also revoke server-side state.

Provide no logout mutation through `GET`.

## Secrets and startup validation

Production variables:

```text
SITE_URL=https://<production-host>
GITHUB_OAUTH_CLIENT_ID=<dedicated-oauth-app-client-id>
GITHUB_OAUTH_CLIENT_SECRET=<dedicated-oauth-app-client-secret>
GITHUB_OWNER_ID=104442054
```

- Seal `GITHUB_OAUTH_CLIENT_SECRET` in Railway. Sealed variables are provided to deployments but cannot be read back through the UI or API ([Railway: Sealed variables](https://docs.railway.com/variables#sealed-variables)).
- Client ID and owner ID are configuration, not secrets.
- Keep the existing GitHub activity `GITHUB_TOKEN` separate; never reuse it for sign-in.
- Use a separate development OAuth App with a loopback callback. Never copy the production client secret into preview environments; Railway does not copy sealed variables there by default.
- Fail production startup if any auth variable is missing, malformed, placeholder-valued, or if the callback is not derived from the validated HTTPS `SITE_URL`.

No additional session-signing secret is required: random session tokens are server-side records and the database stores only their digest.

## Logging and failure behavior

Never log:

- authorization code;
- OAuth access token;
- PKCE verifier;
- state value;
- Cookie/Set-Cookie headers;
- CSRF token;
- client secret;
- request bodies from auth endpoints.

Log structured event names, timestamps, and result categories only: `oauth_started`, `oauth_state_rejected`, `oauth_github_failed`, `oauth_owner_rejected`, `session_created`, `session_expired`, and `session_revoked`.

Failure rules:

- GitHub unavailable/token exchange failure: `503`, no session.
- Invalid/expired/replayed OAuth attempt: `400`, clear attempt cookie.
- GitHub identity mismatch: generic `403`, delete temporary token.
- Session database unavailable: deny all Owner-workspace access; never fall back to a stateless or public mode.
- Session expired during autosave: API `401`; workspace stops writes and asks for sign-in without pretending the draft saved.

## Required tests

Implementation is incomplete until tests prove:

- every Owner-workspace route and asset is denied without a session;
- public HTML contains no admin bundle or controls;
- wrong numeric GitHub ID is rejected even when login text matches;
- renamed login with the approved numeric ID is accepted;
- state mismatch, missing attempt cookie, reused state, expired attempt, and wrong PKCE verifier fail;
- non-empty GitHub scope fails;
- GitHub token deletion happens and the token is never persisted;
- session fixation is prevented by fresh login tokens;
- idle and absolute expiry work;
- logout revokes server state and clears the cookie;
- unsafe methods fail for missing/wrong Origin or CSRF token;
- mutation through `GET` returns `405`;
- private responses are `no-store`;
- public routes remain byte-independent of session cookies.

## Final recommendation

Adopt a dedicated, zero-scope GitHub OAuth App as a one-time identity proof. Bind the authorization code flow with PKCE `S256` and one-use state; allow only GitHub user ID `104442054`; delete the temporary GitHub token; then issue one short-lived opaque SQLite-backed session in a `__Host-` cookie.

Require an exact trusted origin plus a session-bound CSRF token for every mutation, protect the entire Owner-workspace route and asset namespace, and fail closed whenever GitHub, session storage, configuration, or verification is unavailable.
