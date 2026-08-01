import { Router } from "./core/router";
import { RequestHandler } from "./core/requestHandler";
import { setupRoutes } from "./routes";
import { serverConfig, getServerUrl } from "./core/config";
import { syncViewsWithBlogPosts } from "./services/views";
import { validateProductionSiteUrl } from "./services/seo";
import { logDevelopmentWorkflowBanner } from "./core/developmentWorkflow";
import { initializeDatabase } from "./database";

const router = new Router();
setupRoutes(router);

const requestHandler = new RequestHandler(router);

validateProductionSiteUrl();

// Sync view data with blog posts on startup
await syncViewsWithBlogPosts();

// Open the content database and apply pending migrations. This never throws:
// nothing public reads from it yet, so a failure must not take down a site that
// is otherwise serving fine. It surfaces through /readyz, which fails the
// deployment and leaves the previous one in place.
const database = initializeDatabase();
console.log(
  database.status === "ok"
    ? `[database] ready at ${database.file} (${database.appliedMigrations} migration(s), phase ${database.cutoverPhase})`
    : `[database] NOT READY at ${database.file}: ${database.error}`
);

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
