/**
 * SSR shell handler - injects page content into the HTML before serving
 * Crawlers see real content instead of empty divs
 * The SPA router still takes over for client-side navigation after initial load
 */

import { readTextFile } from "../core/file";
import { loadPageContent } from "./api";
import { getBlogPostBySlug } from "./blog";
import { getProjectBySlug, renderProjectArticle } from "./projects";
import { createErrorResponse, NotFoundError } from "../core/errors";
import { CollectionPageNotFoundError } from "../services/collectionPages";
import {
  createSeoMetadata,
  renderSeoHead,
  type SeoPageInput,
} from "../services/seo";
import {
  applySeoHead,
  injectPageContent,
  replacePageStylesheet,
  type ContainerId,
} from "./shellDocument";

interface ShellDependencies {
  loadPageContent: typeof loadPageContent;
}

const defaultDependencies: ShellDependencies = {
  loadPageContent,
};

export function createShellHandler(
  url: URL,
  params: Record<string, string> | undefined = undefined,
  dependencies: ShellDependencies = defaultDependencies
) {
  return async (): Promise<Response> => {
    try {
      if (url.pathname === "/home") {
        return new Response(null, {
          status: 308,
          headers: { Location: "/" },
        });
      }

      let html = await readTextFile("./src/pages/shell.html");
      const pathname = url.pathname;

      let pageContent = "";
      let containerId: ContainerId = "home-page";
      let seoInput: SeoPageInput = { kind: "home" };
      let pageCss = "/pages/home/styles.css";

      if (params?.slug && pathname.startsWith("/blog/")) {
        // Blog post route
        const post = await getBlogPostBySlug(params.slug);
        if (post) {
          const wrappedHtml = `<div class="markdown-content">${post.html}</div>`;
          pageContent = `<article class="blog-post"><a href="/blog" class="back-to-blog back-link">&larr; Back to Blog</a><div class="blog-post-content">${wrappedHtml}</div></article>`;
          containerId = "blog-post-page";
          pageCss = "/pages/blog/styles.css";
          seoInput = {
            kind: "blog-post",
            slug: post.slug,
            title: post.metadata.title,
            description: post.metadata.excerpt || "",
            date: post.metadata.date,
          };
        } else {
          return createErrorResponse(new NotFoundError("Blog post not found"));
        }
      } else if (params?.slug && pathname.startsWith("/projects/")) {
        // Project route
        const project = await getProjectBySlug(params.slug);
        if (project) {
          pageContent = `<div class="project-page-shell"><a href="/projects" class="back-to-projects back-link">&larr; All projects</a>${renderProjectArticle(project)}</div>`;
          containerId = "project-page";
          pageCss = "/pages/projects/styles.css?v=mobile-no-hover";
          seoInput = {
            kind: "project",
            slug: project.slug,
            title: project.metadata.title,
            description: project.metadata.description || "",
          };
        } else {
          return createErrorResponse(new NotFoundError("Project not found"));
        }
      } else {
        // Regular page (home, about, blog listing, projects listing)
        let pageName: "home" | "about" | "blog" | "projects" = "home";
        if (pathname === "/about") pageName = "about";
        else if (pathname === "/blog") pageName = "blog";
        else if (pathname === "/projects") pageName = "projects";

        try {
          const pageNumber = Number(url.searchParams.get("page") || 1);
          const pageData = await dependencies.loadPageContent(
            pageName,
            pageNumber
          );
          pageContent = pageData.content;
          containerId = `${pageName}-page`;
          pageCss = pageData.pageCSS;
          seoInput =
            pageName === "blog" || pageName === "projects"
              ? { kind: pageName, page: pageNumber }
              : { kind: pageName };
        } catch (error) {
          if (error instanceof CollectionPageNotFoundError) {
            return createErrorResponse(
              new NotFoundError("Collection page not found")
            );
          }
          throw error;
        }
      }

      html = injectPageContent(html, containerId, pageContent);

      const seo = createSeoMetadata(seoInput, url);
      html = applySeoHead(html, renderSeoHead(seo));
      html = replacePageStylesheet(html, pageCss);

      return new Response(html, {
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "no-cache",
        },
      });
    } catch (error) {
      console.error("Error in shell handler:", error);
      return new Response("Internal Server Error", {
        status: 500,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
  };
}
