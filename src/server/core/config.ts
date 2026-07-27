import type { ServerConfig } from './types';

const DEFAULT_PORT = 8000;
const environmentPort = Number.parseInt(process.env.PORT ?? '', 10);
const port = Number.isInteger(environmentPort) && environmentPort > 0 && environmentPort <= 65535
  ? environmentPort
  : DEFAULT_PORT;

/**
 * Server configuration
 */
export const serverConfig: ServerConfig = {
  port,
  hostname: process.env.HOST ?? '0.0.0.0',
  
  // Static file handling
  static: {
    publicPath: '/public/',
    pagesPath: '/pages/',
    layoutPath: '/layout/',
    allowedExtensions: ['.css', '.js', '.ts', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.md'] as const
  }
};

/**
 * Get the server URL
 */
export function getServerUrl(port: number = serverConfig.port): string {
  return `http://${serverConfig.hostname}:${port}`;
}
