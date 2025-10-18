import { Router } from './core/router.ts';
import { RequestHandler } from './core/requestHandler.ts';
import { setupRoutes } from './routes';
import { serverConfig, getServerUrl } from './core/config.ts';

// Initialize router and setup routes
const router = new Router();
setupRoutes(router);

// Create request handler
const requestHandler = new RequestHandler(router);

// Start server
const server = Bun.serve({
  port: serverConfig.port,
  async fetch(request) {
    return await requestHandler.handleRequest(request);
  },
});

console.log(`Server running at ${getServerUrl(server.port)}`);
