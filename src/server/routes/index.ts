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
import {
  adminLoginHandler,
  adminLogoutHandler,
  adminSignInCallbackHandler,
  adminSignInStartHandler,
} from "../handlers/admin";
import {
  workbenchHandler,
  workbenchPreviewHandler,
} from "../handlers/workbench";
import { mediaListHandler, mediaUploadHandler } from "../handlers/media";
import { contentDraftHandler } from "../handlers/contentDraft";
import { collectionCreateHandler } from "../handlers/collectionLifecycle";

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

  // Owner workspace. Everything under /admin passes the boundary in
  // `requestHandler.ts` before reaching any of these, including paths that
  // match no route at all — registration here decides what exists, not what is
  // protected.
  router.addRoute("/admin", workbenchHandler);
  // The preview pane's iframe target. Inside the boundary like everything else
  // under /admin, so the generation it renders stays owner-only.
  router.addRoute("/admin/preview", workbenchPreviewHandler);
  router.addRoute("/admin/login", adminLoginHandler);
  router.addRoute("/admin/auth/github/start", adminSignInStartHandler);
  router.addRoute("/admin/auth/github/callback", adminSignInCallbackHandler);
  // Sign-out changes server state, so it is a POST and nothing else. Declaring
  // the method here is what makes `GET /admin/logout` a 405 rather than a
  // logout link an attacker can put in an <img> tag.
  router.addRoute("/admin/logout", adminLogoutHandler, { methods: ["POST"] });

  // Owner media. Uploads are POST-only for the same reason logout is: the
  // method list is what makes a mutation-through-GET a 405 rather than
  // something an <img> tag can trigger.
  router.addRoute("/admin/api/media", mediaUploadHandler, {
    methods: ["POST"],
  });
  router.addRoute("/admin/api/media/list", mediaListHandler);
  router.addRoute("/admin/api/content/:id", contentDraftHandler, {
    methods: ["GET", "PUT", "DELETE"],
  });
  router.addRoute("/admin/api/content", collectionCreateHandler, {
    methods: ["POST"],
  });
}
