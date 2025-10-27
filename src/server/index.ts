import { Router } from './core/router.ts';
import { RequestHandler } from './core/requestHandler.ts';
import { setupRoutes } from './routes';
import { serverConfig, getServerUrl } from './core/config.ts';
import { syncViewsWithBlogPosts } from './services/views.ts';


const router = new Router();
setupRoutes(router);


const requestHandler = new RequestHandler(router);

// Sync view data with blog posts on startup
await syncViewsWithBlogPosts();

// start server
const server = Bun.serve({
  port: serverConfig.port,
  async fetch(request) {
    return await requestHandler.handleRequest(request);
  },
});

console.log(`Server running at ${getServerUrl(server.port)}`);
