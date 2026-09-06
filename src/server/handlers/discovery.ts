import { getAllBlogPosts } from "./blog";
import { getAllProjects } from "./projects";
import { BLOG_PAGE_SIZE, PROJECT_PAGE_SIZE } from "../services/collectionPages";
import {
  absoluteImageUrl,
  getCanonicalUrl,
  type SeoPageInput,
} from "../services/seo";
import { homeConfig } from "../../config";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function collectionPages(
  kind: "blog" | "projects",
  itemCount: number,
  pageSize: number
): SeoPageInput[] {
  const totalPages = Math.ceil(itemCount / pageSize);
  return Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => ({
    kind,
    page: index + 2,
  }));
}

export function createSitemapHandler(url: URL) {
  return async (): Promise<Response> => {
    const [posts, projects] = await Promise.all([
      getAllBlogPosts(),
      getAllProjects(),
    ]);

    const pages: SeoPageInput[] = [
      { kind: "home" },
      { kind: "about" },
      { kind: "blog", page: 1 },
      ...collectionPages("blog", posts.length, BLOG_PAGE_SIZE),
      { kind: "projects", page: 1 },
      ...collectionPages("projects", projects.length, PROJECT_PAGE_SIZE),
      ...posts.map((post) => ({
        kind: "blog-post" as const,
        slug: post.slug,
        title: post.title,
        description: post.excerpt || "",
        date: post.date,
      })),
      ...projects.map((project) => ({
        kind: "project" as const,
        slug: project.slug,
        title: project.title,
        description: project.description || "",
      })),
    ];
    const canonicalUrls = Array.from(
      new Set(pages.map((page) => getCanonicalUrl(page, url)))
    );
    const homeUrl = getCanonicalUrl({ kind: "home" }, url);
    const portraitUrl = absoluteImageUrl(
      homeConfig.author.photo,
      new URL(homeUrl).origin
    );
    const entries = canonicalUrls
      .map((canonical) =>
        canonical === homeUrl
          ? `  <url><loc>${escapeXml(canonical)}</loc><image:image><image:loc>${escapeXml(portraitUrl)}</image:loc></image:image></url>`
          : `  <url><loc>${escapeXml(canonical)}</loc></url>`
      )
      .join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries}
</urlset>`;

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  };
}

export function createRobotsHandler(url: URL) {
  return async (): Promise<Response> => {
    const siteRoot = getCanonicalUrl({ kind: "home" }, url);
    const sitemapUrl = new URL("/sitemap.xml", siteRoot).toString();
    const body = `User-agent: *
Allow: /
Sitemap: ${sitemapUrl}
`;

    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  };
}
