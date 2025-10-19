import { Router } from './core/router.ts';
import { RequestHandler } from './core/requestHandler.ts';
import { setupRoutes } from './routes';
import { serverConfig, getServerUrl } from './core/config.ts';


const router = new Router();
setupRoutes(router);


const requestHandler = new RequestHandler(router);

// start server
const server = Bun.serve({
  port: serverConfig.port,
  async fetch(request) {
    return await requestHandler.handleRequest(request);
  },
});

console.log(`Server running at ${getServerUrl(server.port)}`);
