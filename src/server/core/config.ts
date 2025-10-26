import type { ServerConfig } from './types.ts';

/**
 * Server configuration
 */
export const serverConfig: ServerConfig = {
  port: 8000,
  hostname: 'localhost',
  
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
