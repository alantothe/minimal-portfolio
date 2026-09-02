/**
 * What the Owner can edit, as a list they can navigate.
 *
 * #44 fixes the left pane's three groups — Pages, Projects, Blog posts — so this
 * module's whole job is turning a generation into that shape. It is deliberately
 * a pure function of a `SiteSnapshot` rather than a query against the content
 * tables: the library has to name the same things the preview pane can show, and
 * the only way to guarantee that is to derive both from one generation.
 *
 * That choice has a consequence worth stating. A draft that has never been
 * published does not appear here. Slice 7b introduces draft editing and will
 * need a second source; until then, showing the owner a row the preview cannot
 * render would be worse than showing fewer rows.
 */

import type { SiteSnapshot } from "../published/snapshot";
import type { CollectionType } from "../content/identity";

export interface LibraryEntry {
  /** Stable across renders, so focus and selection survive a refresh. */
  id: string;
  label: string;
  /**
   * The public route whose preview shows this entry.
   *
   * Every entry has one. An editable thing the owner cannot see the effect of
   * is the failure mode the right-hand pane exists to prevent.
   */
  route: string;
  /** Shown under the label. Empty when the entry has nothing to add. */
  supportingText: string;
}

export interface LibrarySection {
  id: string;
  label: string;
  collectionType?: CollectionType;
  entries: LibraryEntry[];
}

/**
 * Branding previews on the home page.
 *
 * The logo and default sharing image are site-wide rather than belonging to one
 * route, so there is no "branding page" to show. Home is the honest choice: it
 * is where the logo appears and it is the route the owner most likely means.
 */
const BRANDING_PREVIEW_ROUTE = "/";

export function contentLibrary(
  snapshot: SiteSnapshot | null
): LibrarySection[] {
  return [
    {
      id: "pages",
      label: "Pages",
      entries: [
        {
          id: "singleton:home",
          label: "Home",
          route: "/",
          supportingText: "",
        },
        {
          id: "singleton:about",
          label: "About",
          route: "/about",
          supportingText: "",
        },
        {
          id: "singleton:branding",
          label: "Branding",
          route: BRANDING_PREVIEW_ROUTE,
          supportingText: "Logo and default sharing image",
        },
      ],
    },
    {
      id: "projects",
      label: "Projects",
      collectionType: "project",
      entries: (snapshot?.projects ?? []).map((project) => ({
        id: project.id,
        label: project.title,
        route: project.route,
        supportingText: project.summary,
      })),
    },
    {
      id: "blog-posts",
      label: "Blog posts",
      collectionType: "blog_post",
      entries: (snapshot?.blogPosts ?? []).map((post) => ({
        id: post.id,
        label: post.title,
        route: post.route,
        // The date the visitor sees, not the storage timestamp. An unpublished
        // post has none, and empty supporting text is better than "null".
        supportingText: post.publishedAt ? post.publishedAt.slice(0, 10) : "",
      })),
    },
  ];
}

/**
 * Whether the workbench may preview a route.
 *
 * The preview pane takes a route from the query string, so it is attacker-
 * controlled in the same sense any owner-supplied input is. Answering only for
 * routes the active generation actually publishes means the pane cannot be
 * pointed at an arbitrary path, and cannot become a way to reach something the
 * Owner boundary would otherwise have refused.
 */
export function isPreviewableRoute(
  snapshot: SiteSnapshot,
  route: string
): boolean {
  return snapshot.routes.includes(route);
}

/** The route the workbench opens on. */
export function defaultPreviewRoute(): string {
  return "/";
}

/** The Content item selected when the workspace first opens. */
export function defaultContentId(): string {
  return "singleton:home";
}

/** Finds one Content item without making its Public route its identity. */
export function findLibraryEntry(
  sections: LibrarySection[],
  contentId: string
): LibraryEntry | null {
  for (const section of sections) {
    const entry = section.entries.find(
      (candidate) => candidate.id === contentId
    );
    if (entry) return entry;
  }

  return null;
}
