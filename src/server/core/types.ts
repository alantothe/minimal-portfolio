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
  featuresPath: string;
  allowedExtensions: readonly string[];
}

export interface Route {
  path: string;
  handler: () => Promise<Response>;
}

export interface RequestContext {
  url: URL;
  method: string;
  headers: Headers;
}

export type RouteHandler = (context: RequestContext) => Promise<Response>;

export interface StaticFileInfo {
  path: string;
  exists: boolean;
  size?: number;
  type?: string;
}
