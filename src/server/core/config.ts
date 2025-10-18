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
    featuresPath: '/features/',
    allowedExtensions: ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg'] as const
  }
};

/**
 * Get the server URL
 */
export function getServerUrl(port: number = serverConfig.port): string {
  return `http://${serverConfig.hostname}:${port}`;
}
