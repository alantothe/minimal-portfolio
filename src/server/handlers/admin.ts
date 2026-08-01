/**
 * The Owner workspace's routes.
 *
 * In this slice the workspace itself is empty — the point of the slice is the
 * boundary around it, not what sits inside. What these handlers do establish is
 * the shape everything later plugs into: the workspace is server-rendered, it
 * carries its CSRF token in the HTML rather than in a cookie, and it loads no
 * scripts or styles from `/public`, whose static path is served unconditionally
 * to everyone.
 */

import type { RouteContext } from "../core/router";
import { resolveAuthConfig } from "../auth/config";
import { HttpGitHubIdentityClient } from "../auth/githubIdentity";
import {
  completeSignIn,
  signOut,
  startSignIn,
  type SignInDependencies,
} from "../auth/signIn";
import { ownerAuthRepository, resolveOwnerSession } from "../auth/session";
import { applyPrivateHeaders } from "../auth/ownerBoundary";

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function unavailable(message: string): Response {
  return new Response(message, {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

type DependencyResolution =
  | { ready: true; dependencies: SignInDependencies }
  | { ready: false; response: Response };

/**
 * Assembles the flow's collaborators, or explains why it cannot.
 *
 * Built per request rather than once at startup so that configuration and
 * database availability are evaluated when they are used. A server that boots
 * before its volume mounts should start refusing sign-ins and then start
 * accepting them, without a restart.
 */
function signInDependencies(): DependencyResolution {
  const resolution = resolveAuthConfig();
  if (resolution.status !== "configured") {
    return {
      ready: false,
      response: unavailable("Owner sign-in is not configured."),
    };
  }

  const repository = ownerAuthRepository();
  if (!repository) {
    return {
      ready: false,
      response: unavailable("Owner sign-in is temporarily unavailable."),
    };
  }

  return {
    ready: true,
    dependencies: {
      config: resolution.config,
      repository,
      client: new HttpGitHubIdentityClient(resolution.config),
    },
  };
}

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    margin: 0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
  }
  main { text-align: center; padding: 2rem; }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 1rem; }
  p { margin: 0 0 1.5rem; opacity: 0.7; font-size: 0.9rem; }
  a.button, button {
    font: inherit; padding: 0.6rem 1.1rem; border-radius: 0.4rem;
    border: 1px solid currentColor; background: transparent;
    color: inherit; text-decoration: none; cursor: pointer;
  }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

export async function adminLoginHandler({
  request,
}: RouteContext): Promise<Response> {
  // Already signed in? Send them where they were going, rather than showing a
  // sign-in button that starts a second round trip for no reason.
  if (resolveOwnerSession(request).status === "active") {
    return applyPrivateHeaders(
      new Response(null, { status: 303, headers: { Location: "/admin" } })
    );
  }

  return applyPrivateHeaders(
    html(
      page(
        "Sign in",
        `<h1>Owner workspace</h1>
<p>This area is restricted to the site owner.</p>
<a class="button" href="/admin/auth/github/start">Continue with GitHub</a>`
      )
    )
  );
}

export async function adminHomeHandler({
  request,
}: RouteContext): Promise<Response> {
  const resolution = resolveOwnerSession(request);
  if (resolution.status !== "active") {
    // The boundary already refused anything unauthenticated; reaching here
    // means state changed mid-request, so fail closed rather than render.
    return applyPrivateHeaders(
      new Response(null, { status: 303, headers: { Location: "/admin/login" } })
    );
  }

  return applyPrivateHeaders(
    html(
      page(
        "Owner workspace",
        `<h1>Owner workspace</h1>
<p>Signed in. There is nothing here yet.</p>
<form method="post" action="/admin/logout" id="signout">
  <button type="submit">Sign out</button>
</form>
<script>
  // The CSRF token lives in the authenticated document and stays in memory.
  // It is never a cookie, so it cannot ride along with a cross-site request.
  const csrf = ${JSON.stringify(resolution.session.csrfToken)};
  document.getElementById("signout").addEventListener("submit", async event => {
    event.preventDefault();
    const response = await fetch("/admin/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      credentials: "same-origin",
    });
    window.location.href = response.redirected ? response.url : "/admin/login";
  });
</script>`
      )
    )
  );
}

export async function adminSignInStartHandler(): Promise<Response> {
  const resolved = signInDependencies();
  if (!resolved.ready) {
    return resolved.response;
  }

  return startSignIn(resolved.dependencies);
}

export async function adminSignInCallbackHandler({
  request,
  url,
}: RouteContext): Promise<Response> {
  const resolved = signInDependencies();
  if (!resolved.ready) {
    return resolved.response;
  }

  return completeSignIn(request, url, resolved.dependencies);
}

export async function adminLogoutHandler({
  request,
}: RouteContext): Promise<Response> {
  const resolution = resolveOwnerSession(request);
  if (resolution.status !== "active") {
    return applyPrivateHeaders(
      new Response(null, { status: 303, headers: { Location: "/admin/login" } })
    );
  }

  const repository = ownerAuthRepository();
  if (!repository) {
    return unavailable("Sign-out is temporarily unavailable.");
  }

  return signOut(repository, resolution.session.tokenDigest);
}
