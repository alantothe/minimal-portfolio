import { Router } from "../core/router";
import { createShellHandler } from "../handlers/shell";
import { createApiHandler } from "../handlers/api";
import { blogListHandler, createBlogPostHandler } from "../handlers/blog";
import {
  projectsListHandler,
  createProjectHandler,
} from "../handlers/projects";
import {
  createRobotsHandler,
  createSitemapHandler,
} from "../handlers/discovery";
import { readinessHandler } from "../handlers/readiness";

export function setupRoutes(router: Router): void {
  router.addRoute(
    "/healthz",
    async () =>
      new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      })
  );
  router.addRoute("/readyz", readinessHandler);
  router.addRoute("/robots.txt", createRobotsHandler);
  router.addRoute("/sitemap.xml", createSitemapHandler);

  // SSR shell routes - content is injected server-side before serving
  router.addRoute("/", createShellHandler);
  router.addRoute("/home", createShellHandler);
  router.addRoute("/about", createShellHandler);
  router.addRoute("/blog", createShellHandler);
  router.addRoute("/blog/:slug", createShellHandler);
  router.addRoute("/projects", createShellHandler);
  router.addRoute("/projects/:slug", createShellHandler);

  //fetches content fragments
  router.addRoute("/api/page", createApiHandler);

  // Blog API routes
  router.addRoute("/api/blog/list", blogListHandler);
  router.addRoute("/api/blog/:slug", createBlogPostHandler);

  // Projects API routes
  router.addRoute("/api/projects/list", projectsListHandler);
  router.addRoute("/api/projects/:slug", createProjectHandler);
}
