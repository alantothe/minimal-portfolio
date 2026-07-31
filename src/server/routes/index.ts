import { Router, fromResponder, fromUrlFactory } from "../core/router";
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
    fromResponder(
      async () =>
        new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        })
    )
  );
  router.addRoute("/readyz", fromResponder(readinessHandler));
  router.addRoute("/robots.txt", fromUrlFactory(createRobotsHandler));
  router.addRoute("/sitemap.xml", fromUrlFactory(createSitemapHandler));

  // SSR shell routes - content is injected server-side before serving
  const shell = fromUrlFactory(createShellHandler);
  router.addRoute("/", shell);
  router.addRoute("/home", shell);
  router.addRoute("/about", shell);
  router.addRoute("/blog", shell);
  router.addRoute("/blog/:slug", shell);
  router.addRoute("/projects", shell);
  router.addRoute("/projects/:slug", shell);

  //fetches content fragments
  router.addRoute("/api/page", fromUrlFactory(createApiHandler));

  // Blog API routes
  router.addRoute("/api/blog/list", fromResponder(blogListHandler));
  router.addRoute("/api/blog/:slug", fromUrlFactory(createBlogPostHandler));

  // Projects API routes
  router.addRoute("/api/projects/list", fromResponder(projectsListHandler));
  router.addRoute("/api/projects/:slug", fromUrlFactory(createProjectHandler));
}
