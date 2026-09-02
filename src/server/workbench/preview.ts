/**
 * Makes the public document behave inside the authenticated preview boundary.
 *
 * The same renderer, styles, and browser router still run. The only extra fact
 * is the Public route represented by `/admin/preview`; the router uses it for
 * initial state and keeps internal navigation inside the database-backed
 * preview instead of falling through to the legacy public APIs.
 */

import { jsonForScript } from "./scriptValue";

const ROUTER_SCRIPT =
  '<script src="/public/spa-router.js?v=media" type="module"></script>';

export function configurePreviewDocument(
  document: string,
  publicRoute: string
): string {
  if (!document.includes(ROUTER_SCRIPT)) {
    throw new Error("Published document is missing the SPA router script");
  }

  const configuration = `<script>globalThis.__PORTFOLIO_PREVIEW_ROUTE__=${jsonForScript(publicRoute)}</script>`;
  return document.replace(
    ROUTER_SCRIPT,
    `${configuration}\n    ${ROUTER_SCRIPT}`
  );
}
