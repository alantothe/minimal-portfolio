import { Router } from './core/router';
import { RequestHandler } from './core/requestHandler';
import { setupRoutes } from './routes';
import { serverConfig, getServerUrl } from './core/config';
import { syncViewsWithBlogPosts } from './services/views';
import { validateProductionSiteUrl } from './services/seo';


const router = new Router();
setupRoutes(router);


const requestHandler = new RequestHandler(router);

validateProductionSiteUrl();

// Sync view data with blog posts on startup
await syncViewsWithBlogPosts();

// start server
const server = Bun.serve({
  port: serverConfig.port,
  hostname: serverConfig.hostname,
  async fetch(request) {
    return await requestHandler.handleRequest(request);
  },
});

console.log(`Server running at ${getServerUrl(server.port)}`);
