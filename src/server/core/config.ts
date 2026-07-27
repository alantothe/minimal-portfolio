import type { ServerConfig } from './types';

export function parsePort(value: string | undefined): number {
  const rawValue = value ?? "8000";
  if (!/^[0-9]+$/.test(rawValue)) {
    throw new Error(`PORT must be an integer from 1 to 65535; received "${rawValue}"`);
  }

  const port = Number(rawValue);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer from 1 to 65535; received "${rawValue}"`);
  }

  return port;
}

/**
 * Server configuration
 */
export const serverConfig: ServerConfig = {
  port: parsePort(process.env.PORT),
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
