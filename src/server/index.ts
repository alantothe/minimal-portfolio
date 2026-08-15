import { Router } from "./core/router";
import { RequestHandler } from "./core/requestHandler";
import { setupRoutes } from "./routes";
import { serverConfig, getServerUrl } from "./core/config";
import { syncViewsWithBlogPosts } from "./services/views";
import { validateProductionSiteUrl } from "./services/seo";
import { logDevelopmentWorkflowBanner } from "./core/developmentWorkflow";
import {
  initializeRecovery,
  requestChangeCheckpoint,
} from "./recovery/runtime";
import { validateRecoveryConfigAtStartup } from "./recovery/config";
import { refuseLegacyContentWhenSealed } from "./cutover/policy";
import {
  appliedMigrationsThisBoot,
  getDatabase,
  initializeDatabase,
} from "./database";
import { initializePublishedSite } from "./published/lifecycle";
import { validateAuthConfigAtStartup } from "./auth/config";
import { validateMediaConfigAtStartup } from "./media/config";
import { reconcileStartupImportBaselines } from "./content/import/startupBaselines";

const router = new Router();
setupRoutes(router);

const requestHandler = new RequestHandler(router);

validateProductionSiteUrl();

// Unlike the database, misconfigured authentication is fatal. A database that
// cannot open leaves the public site working; an Owner workspace with a broken
// or half-present OAuth App is a security boundary in an unknown state, and the
// only safe response is to refuse to start.
validateAuthConfigAtStartup();

// Media configuration is optional even in production — absent credentials
// disable uploading, which costs the public site nothing. A contradictory
// configuration is still fatal, because it means someone meant to set this up.
validateMediaConfigAtStartup();
// Recovery is optional until R2 recipients exist. Partial configuration is
// fatal everywhere, matching media: someone meant to turn this on.
validateRecoveryConfigAtStartup();

// Sync view data with blog posts on startup
await syncViewsWithBlogPosts();

// Open the content database and apply pending migrations. This never throws:
// during `legacy` and `shadow` the public site is served from repository
// content, so a database that fails to open must not take down a working site.
// From `sqlite-observation` onward `/readyz` fails the deploy instead.
const database = initializeDatabase();
if (database.status === "ok" && database.cutoverPhase) {
  refuseLegacyContentWhenSealed(database.cutoverPhase, {
    forceLegacyContent: process.env.CUTOVER_FORCE_LEGACY_CONTENT === "1",
  });
}
console.log(
  database.status === "ok"
    ? `[database] ready at ${database.file} (${database.appliedMigrations} migration(s), phase ${database.cutoverPhase})`
    : `[database] NOT READY at ${database.file}: ${database.error}`
);

// Build and warm the published generation. Public routes read it from
// `sqlite-observation` onward. Warming here means a later phase change does
// not wait for the first Visitor, and a process that survives SQLite going
// away later still holds a last-known-good site. During `legacy` a build
// failure is reported rather than fatal.
if (database.status === "ok") {
  await reconcileStartupImportBaselines(getDatabase());
  initializePublishedSite();
  initializeRecovery();
  const applied = appliedMigrationsThisBoot();
  if (applied.length > 0) {
    requestChangeCheckpoint(`migration-${applied.join("-")}`);
  }
}

// start server
const server = Bun.serve({
  port: serverConfig.port,
  hostname: serverConfig.hostname,
  async fetch(request) {
    return await requestHandler.handleRequest(request);
  },
});

console.log(`Server running at ${getServerUrl(server.port)}`);
logDevelopmentWorkflowBanner();
