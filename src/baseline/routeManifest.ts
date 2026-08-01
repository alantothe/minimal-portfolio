/**
 * Every public route the site answers, derived from committed content rather
 * than hand-listed, so new Blog posts and Projects widen the contract on their
 * own instead of silently escaping it.
 */

import { getAllBlogPosts } from "../server/handlers/blog";
import { getAllProjects } from "../server/handlers/projects";
import {
  BLOG_PAGE_SIZE,
  PROJECT_PAGE_SIZE,
} from "../server/services/collectionPages";
import type { RouteRequest } from "./contract";

/** Paths that prove the site still refuses what it should refuse. */
const NOT_FOUND_PROBES = [
  "/blog/does-not-exist",
  "/projects/does-not-exist",
  "/projects/%2e%2e%2fprojects%2fminimal-portfolio",
  "/blog?page=99",
  "/projects?page=99",
];

function collectionRoutes(
  basePath: "/blog" | "/projects",
  itemCount: number,
  pageSize: number
): RouteRequest[] {
  const totalPages = Math.max(1, Math.ceil(itemCount / pageSize));
  return Array.from({ length: totalPages }, (_, index) => {
    const page = index + 1;
    return {
      path: page === 1 ? basePath : `${basePath}?page=${page}`,
      kind: "collection" as const,
    };
  });
}

export async function buildRouteManifest(): Promise<RouteRequest[]> {
  const [posts, projects] = await Promise.all([
    getAllBlogPosts(),
    getAllProjects(),
  ]);

  const postSlugs = posts.map((post) => post.slug).sort();
  const projectSlugs = projects.map((project) => project.slug).sort();

  return [
    { path: "/healthz", kind: "health" },
    { path: "/robots.txt", kind: "discovery" },
    { path: "/sitemap.xml", kind: "discovery" },

    { path: "/", kind: "page" },
    { path: "/home", kind: "redirect" },
    { path: "/about", kind: "page" },

    ...collectionRoutes("/blog", posts.length, BLOG_PAGE_SIZE),
    ...collectionRoutes("/projects", projects.length, PROJECT_PAGE_SIZE),

    ...postSlugs.map((slug) => ({
      path: `/blog/${slug}`,
      kind: "blog-post" as const,
    })),
    ...projectSlugs.map((slug) => ({
      path: `/projects/${slug}`,
      kind: "project" as const,
    })),

    ...(["home", "about", "blog", "projects"] as const).map((name) => ({
      path: `/api/page?name=${name}`,
      kind: "api" as const,
    })),
    { path: "/api/blog/list", kind: "api" },
    { path: "/api/projects/list", kind: "api" },
    ...postSlugs.map((slug) => ({
      path: `/api/blog/${slug}`,
      kind: "api" as const,
    })),
    ...projectSlugs.map((slug) => ({
      path: `/api/projects/${slug}`,
      kind: "api" as const,
    })),

    ...NOT_FOUND_PROBES.map((path) => ({
      path,
      kind: "not-found" as const,
    })),
  ];
}
