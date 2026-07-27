import type { ServerConfig } from './types';

/**
 * Server configuration
 */
export const serverConfig: ServerConfig = {
  port: Number(process.env.PORT || 8000),
  hostname: process.env.HOST || '0.0.0.0',
  
  // Static file handling
  static: {
    publicPath: '/public/',
    pagesPath: '/pages/',
    layoutPath: '/layout/',
    allowedExtensions: ['.css', '.js', '.ts', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.md'] as const
  }
};

/**
 * Get the server URL
 */
export function getServerUrl(port: number = serverConfig.port): string {
  return `http://${serverConfig.hostname}:${port}`;
}
