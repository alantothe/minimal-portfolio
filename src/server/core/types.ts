/**
 * Type definitions for the server
 */

export interface ServerConfig {
  port: number;
  hostname: string;
  static: StaticConfig;
}

export interface StaticConfig {
  publicPath: string;
  pagesPath: string;
  layoutPath: string;
  allowedExtensions: readonly string[];
}

export interface Route {
  path: string;
  handler: () => Promise<Response>;
}
