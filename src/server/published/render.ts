/**
 * Turning one resolved page into the representations a Visitor receives.
 *
 * The page *templates* are deliberately the same files the legacy renderer uses.
 * What this slice replaces is where the values come from — a validated
 * generation instead of a filesystem scan and a config module — not what the
 * site looks like. Reusing the templates is what makes that claim checkable:
 * a parity difference can only be a difference in content, because the markup
 * around it is literally the same bytes.
 *
 * The same reasoning applies to the collection and case-study renderers, which
 * are imported from the legacy handlers rather than reimplemented. A second
 * copy of that markup would drift, and every drift would surface as a parity
 * failure that took an afternoon to prove harmless.
 *
 * Optional enrichment — GitHub activity, view counts — is a *parameter*. It is
 * never fetched here. That keeps this module a pure function of the generation
 * plus whatever the caller managed to gather, which is the shape #34 requires
 * for "optional data must never take core published pages down": a caller with
 * nothing to offer still gets a complete page.
 */

import { readTextFile } from "../core/file";
import {
  renderBlogCollection,
  renderProjectCollection,
} from "../services/collectionPages";
import { renderProjectArticle, type ProjectDetail } from "../handlers/projects";
import {
  applySeoHead,
  injectPageContent,
  replacePageStylesheet,
  type ContainerId,
} from "../handlers/shellDocument";
import { renderSeoHead } from "../services/seo";
import { publishedSeoMetadata } from "./seo";
import type { SiteSnapshot, PublishedProject } from "./snapshot";
import type { FoundPage, PublishedView } from "./target";

/**
 * Values that are true about the site but are not published content.
 *
 * Every field is nullable because every one of them comes from something that
 * can be down. `null` means "we do not know", which renders as the existing
 * neutral state; it never renders as `0`, because reporting zero commits as
 * fact when GitHub is unreachable is inventing data.
 */
export interface SiteEnrichment {
  githubCommits: number | null;
  githubActivityPanel: string;
  blogPostCount: number | null;
  totalViews: number | null;
  viewsBySlug: Record<string, number>;
}

export const NO_ENRICHMENT: SiteEnrichment = {
  githubCommits: null,
  githubActivityPanel: "",
  blogPostCount: null,
  totalViews: null,
  viewsBySlug: {},
};

export interface PublishedPage {
  content: string;
  title: string;
  activePage: string;
  pageCSS: string;
  containerId: ContainerId;
}

const TEMPLATES: Record<string, string> = {
  home: "./src/pages/home/content.html",
  about: "./src/pages/about/content.html",
  blog: "./src/pages/blog/content.html",
  projects: "./src/pages/projects/content.html",
};

const PAGE_CSS: Record<string, string> = {
  home: "/pages/home/styles.css",
  about: "/pages/about/styles.css",
  blog: "/pages/blog/styles.css",
  projects: "/pages/projects/styles.css",
};

const PAGE_TITLES: Record<string, string> = {
  home: "Home - Portfolio",
  about: "About - Portfolio",
  blog: "Blog - Portfolio",
  projects: "Projects - Portfolio",
};

/**
 * Fills `{{a.b.c}}` placeholders.
 *
 * Kept identical to the legacy substitution, including leaving an unresolved
 * placeholder in place. Making it stricter here would be a behaviour change
 * disguised as a cleanup, and this slice may not change what a page renders.
 */
function processTemplate(html: string, data: unknown): string {
  return html.replace(/\{\{([^}]+)\}\}/g, (match, path: string) => {
    let value: unknown = data;

    for (const key of path.trim().split(".")) {
      if (value === null || typeof value !== "object") return match;
      value = (value as Record<string, unknown>)[key];
      if (value === undefined) return match;
    }

    return String(value);
  });
}

/** A number the site can show, or the empty string when it is not known. */
function metric(value: number | null): string {
  return value === null ? "" : String(value);
}

/**
 * Rewrites the portrait's intrinsic size to the size actually being delivered.
 *
 * The template carries the legacy asset's dimensions as literal attributes, and
 * this slice may not edit the template — it is fingerprinted by the golden
 * contract, so changing it would rewrite the very artifact the parity run is
 * measured against. The published portrait is delivered at its variant's size,
 * which is usually different, and shipping the template's numbers with a
 * differently sized image is a guaranteed layout shift on first paint.
 *
 * So the renderer corrects what it knows it is serving. Anchored on the two
 * `profile` image classes rather than on every `<img>`, so no other image on the
 * page can be caught by it.
 */
function withPortraitDimensions(
  html: string,
  size: { width: number; height: number } | null
): string {
  if (!size) return html;

  return html.replace(
    /<img\b[^>]*\bclass="(?:profile-img|avatar-lightbox__image)"[^>]*>|<img\b(?=[^>]*\bclass="(?:profile-img|avatar-lightbox__image)")[^>]*>/g,
    (tag) =>
      tag
        .replace(/\bwidth="\d+"/, `width="${size.width}"`)
        .replace(/\bheight="\d+"/, `height="${size.height}"`)
  );
}

function homeContext(
  snapshot: SiteSnapshot,
  enrichment: SiteEnrichment
): unknown {
  const { home } = snapshot;

  return {
    author: {
      name: home.displayName,
      firstName: home.firstName,
      email: home.email,
      githubUsername: home.githubUsername,
      photo: home.portrait?.url ?? "",
    },
    professional: {
      title: home.professionalTitle,
      intro: home.introHtml,
      bio: home.bioHtml,
    },
    metrics: {
      githubCommits: metric(enrichment.githubCommits),
      githubActivityPanel: enrichment.githubActivityPanel,
      blogPostCount: metric(enrichment.blogPostCount),
      totalViews: metric(enrichment.totalViews),
    },
  };
}

function aboutContext(snapshot: SiteSnapshot): unknown {
  const { about } = snapshot;
  const paragraphs = about.featuredBodyParagraphs;

  return {
    sections: {
      personal: {
        intro: about.introHtml,
        hobbies: about.hobbiesHtml,
        socialLinks: about.socialLinks.map((link) => ({
          name: link.label,
          url: link.url,
        })),
      },
      questurian: {
        title: about.featuredTitle,
        description1: paragraphs[0] ?? "",
        description2: paragraphs[1] ?? "",
        description3: paragraphs[2] ?? "",
      },
    },
  };
}

/** The shape the legacy project renderers expect, built from a generation. */
function toProjectDetail(project: PublishedProject): ProjectDetail {
  return {
    slug: project.slug,
    metadata: {
      title: project.title,
      description: project.summary,
      image: project.card?.url,
      kicker: project.kicker,
      role: project.role,
      status: project.status,
      year: project.period,
      stack: project.technologies,
      accent: project.accentColor,
      live: project.liveUrl,
      repository: project.repositoryUrl,
    },
    html: project.bodyHtml,
  };
}

/**
 * Renders the page body for a resolved target.
 *
 * Returns the same four fields the legacy `loadPageContent` returns, plus the
 * container the SSR shell has to activate. Matching that shape is what lets the
 * shadow comparison diff the two renderers directly instead of through a
 * translation layer that could hide a difference.
 */
export async function renderPublishedPage(
  view: PublishedView,
  snapshot: SiteSnapshot,
  enrichment: SiteEnrichment = NO_ENRICHMENT
): Promise<PublishedPage> {
  switch (view.kind) {
    case "home": {
      const template = await readTextFile(TEMPLATES.home!);
      const content = withPortraitDimensions(
        processTemplate(template, homeContext(snapshot, enrichment)),
        snapshot.home.portrait
      );

      return {
        content: content.trim(),
        title: PAGE_TITLES.home!,
        activePage: "home",
        pageCSS: PAGE_CSS.home!,
        containerId: "home-page",
      };
    }

    case "about": {
      const template = await readTextFile(TEMPLATES.about!);

      return {
        content: processTemplate(template, aboutContext(snapshot)).trim(),
        title: PAGE_TITLES.about!,
        activePage: "about",
        pageCSS: PAGE_CSS.about!,
        containerId: "about-page",
      };
    }

    case "blog-collection": {
      const template = await readTextFile(TEMPLATES.blog!);
      const collection = renderBlogCollection(
        view.posts.map((post) => ({
          slug: post.slug,
          title: post.title,
          date: post.publishedAt ?? "",
          excerpt: post.excerpt,
          views: enrichment.viewsBySlug[post.slug] ?? 0,
        })),
        // The page's items were already selected by `resolve`, so the collection
        // renderer is asked for page one of exactly those.
        1
      );

      return {
        content: template
          .replace("{{collection.items}}", collection.itemsHtml)
          .replace(
            "{{collection.pagination}}",
            renderPaginationFor("/blog", view.page, view.totalPages)
          )
          .trim(),
        title: pagedTitle("blog", view.page),
        activePage: "blog",
        pageCSS: PAGE_CSS.blog!,
        containerId: "blog-page",
      };
    }

    case "project-collection": {
      const template = await readTextFile(TEMPLATES.projects!);
      const collection = renderProjectCollection(
        view.projects.map((project) => ({
          slug: project.slug,
          title: project.title,
          description: project.summary,
          image: project.card?.url,
          kicker: project.kicker,
          stack: project.technologies,
          accent: project.accentColor,
        })),
        1
      );

      return {
        content: template
          .replace("{{collection.items}}", collection.itemsHtml)
          .replace(
            "{{collection.pagination}}",
            renderPaginationFor("/projects", view.page, view.totalPages)
          )
          .trim(),
        title: pagedTitle("projects", view.page),
        activePage: "projects",
        pageCSS: PAGE_CSS.projects!,
        containerId: "projects-page",
      };
    }

    case "blog-post": {
      const wrapped = `<div class="markdown-content">${view.post.bodyHtml}</div>`;

      return {
        content: `<article class="blog-post"><a href="/blog" class="back-to-blog back-link">&larr; Back to Blog</a><div class="blog-post-content">${wrapped}</div></article>`,
        title: view.post.title,
        activePage: "blog",
        pageCSS: PAGE_CSS.blog!,
        containerId: "blog-post-page",
      };
    }

    case "project": {
      const article = renderProjectArticle(toProjectDetail(view.project));

      return {
        content: `<div class="project-page-shell"><a href="/projects" class="back-to-projects back-link">&larr; All projects</a>${article}</div>`,
        title: view.project.title,
        activePage: "projects",
        pageCSS: PAGE_CSS.projects!,
        containerId: "project-page",
      };
    }
  }
}

function pagedTitle(page: "blog" | "projects", pageNumber: number): string {
  const base = PAGE_TITLES[page]!;
  return pageNumber > 1 ? `${base} - Page ${pageNumber}` : base;
}

/**
 * Pagination for a collection whose page count is already known.
 *
 * The legacy renderer derives the count from the full item list it was handed.
 * Here the generation knows it, so it is passed in — which is also what lets
 * `resolve` hand a page its own items rather than the whole collection.
 */
function renderPaginationFor(
  basePath: "/blog" | "/projects",
  page: number,
  totalPages: number
): string {
  if (totalPages <= 1) return "";

  const links = Array.from({ length: totalPages }, (_, index) => {
    const pageNumber = index + 1;
    const href = pageNumber === 1 ? basePath : `${basePath}?page=${pageNumber}`;
    const current = pageNumber === page ? ' active" aria-current="page' : "";
    return `<a class="pagination-btn${current}" href="${href}">${pageNumber}</a>`;
  }).join("");

  return `<nav class="pagination-controls" aria-label="Pagination"><div class="pagination-numbers">${links}</div></nav>`;
}

/**
 * The complete server-rendered document for a found page.
 *
 * SEO comes from the same resolution as the body, so the head and the content a
 * crawler reads can never describe different generations.
 */
export async function renderPublishedDocument(
  page: FoundPage,
  snapshot: SiteSnapshot,
  requestUrl: URL,
  enrichment: SiteEnrichment = NO_ENRICHMENT
): Promise<string> {
  const rendered = await renderPublishedPage(page.view, snapshot, enrichment);
  const seo = publishedSeoMetadata(page, snapshot, requestUrl);

  let html = await readTextFile("./src/pages/shell.html");
  html = injectPageContent(html, rendered.containerId, rendered.content);
  html = applySeoHead(html, renderSeoHead(seo));

  return replacePageStylesheet(html, rendered.pageCSS);
}
