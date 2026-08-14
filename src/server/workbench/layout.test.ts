/**
 * The structural promises #36 §9 makes, as tests.
 *
 * These assert the properties a reviewer cannot see by looking at a screenshot:
 * that every region has a name, that the reading order matches the visual one,
 * that ARIA is not claiming a widget that is not there, and that owner content
 * cannot become markup. A visual regression test would pass on a page that
 * failed every one of them.
 */

import { describe, expect, test } from "bun:test";
import { renderWorkbench, escapeHtml, type WorkbenchView } from "./layout";
import type { LibrarySection } from "./library";

const sections: LibrarySection[] = [
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
    ],
  },
  {
    id: "projects",
    label: "Projects",
    collectionType: "project",
    entries: [
      {
        id: "project:questurian",
        label: "Questurian",
        route: "/projects/questurian",
        supportingText: "shipped",
      },
    ],
  },
  {
    id: "blog-posts",
    label: "Blog posts",
    collectionType: "blog_post",
    entries: [],
  },
];

function view(overrides: Partial<WorkbenchView> = {}): WorkbenchView {
  return {
    generation: "abcdef1234567890",
    previewStatus: "ready",
    draftStatus: "not-opened",
    sections,
    selectedContentId: "singleton:home",
    previewRoute: "/",
    csrfToken: "token-value",
    editor: { status: "missing", message: "Not available in this fixture." },
    ...overrides,
  };
}

describe("landmarks and headings", () => {
  test("each pane is a landmark with its own accessible name", () => {
    const html = renderWorkbench(view());

    expect(html).toContain('<nav class="pane library" id="library"');
    expect(html).toContain('aria-labelledby="library-heading"');
    expect(html).toContain('<main class="pane" id="editor"');
    expect(html).toContain('aria-labelledby="editor-heading"');
    expect(html).toContain('aria-labelledby="preview-heading"');

    // Every id referenced by an aria-labelledby has to exist, or the name
    // silently resolves to nothing.
    for (const id of ["library-heading", "editor-heading", "preview-heading"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  test("there is exactly one h1 and it is in the status rail", () => {
    const html = renderWorkbench(view());

    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html.indexOf("<h1>")).toBeLessThan(
      html.indexOf('class="workbench"')
    );
  });

  test("a skip link is the first focusable thing and targets the editor", () => {
    const html = renderWorkbench(view());

    expect(html).toContain('<a class="skip-link" href="#editor">');
    expect(html.indexOf("skip-link")).toBeLessThan(html.indexOf("<header"));
    expect(html).toContain('id="editor"');
  });

  test("reading order is library, then editor, then preview", () => {
    const html = renderWorkbench(view());

    expect(html.indexOf('id="library"')).toBeLessThan(
      html.indexOf('id="editor"')
    );
    expect(html.indexOf('id="editor"')).toBeLessThan(
      html.indexOf('id="preview"')
    );
  });
});

describe("the preview boundary", () => {
  test("the iframe is titled with the route it is showing", () => {
    const html = renderWorkbench(view({ previewRoute: "/about" }));

    expect(html).toContain('title="Public preview of /about"');
    expect(html).toContain('src="/admin/preview?route=%2Fabout"');
  });

  test("no iframe is rendered when there is nothing to preview", () => {
    const html = renderWorkbench(
      view({ previewStatus: "unavailable", generation: null })
    );

    // An empty frame would look like a broken page. The sentence says why.
    expect(html).not.toContain("<iframe");
    expect(html).toContain("No complete Content draft exists yet");
  });

  test("degraded says the draft preview is stale rather than only naming a status", () => {
    const html = renderWorkbench(view({ previewStatus: "degraded" }));

    expect(html).toContain("Showing the last good draft preview");
    expect(html).toContain("<iframe");
  });
});

describe("the library", () => {
  test("the previewed entry is marked with aria-current", () => {
    const html = renderWorkbench(
      view({
        selectedContentId: "singleton:about",
        previewRoute: "/about",
      })
    );

    expect(html).toContain(
      '<a href="/admin?content=singleton%3Aabout" aria-current="true">About'
    );
    // And only that one. Scoped past the stylesheet, which selects on the same
    // attribute to style it.
    const markup = html.split("</style>")[1]!;
    expect(markup.match(/aria-current="true"/g)).toHaveLength(1);
  });

  test("two Content items sharing a Public route remain distinct", () => {
    const html = renderWorkbench(
      view({
        sections: [
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
                id: "singleton:branding",
                label: "Branding",
                route: "/",
                supportingText: "",
              },
            ],
          },
        ],
        selectedContentId: "singleton:branding",
      })
    );
    const markup = html.split("</style>")[1]!;

    expect(markup.match(/aria-current="true"/g)).toHaveLength(1);
    expect(markup).toContain(
      '<a href="/admin?content=singleton%3Abranding" aria-current="true">Branding'
    );
  });

  test("an empty section says so instead of rendering an empty list", () => {
    const html = renderWorkbench(view());

    expect(html).toContain("Nothing here yet.");
    expect(html).toContain('href="/admin?new=blog_post">Add Blog post</a>');
  });

  test("collection sections expose creation without duplicating singletons", () => {
    const html = renderWorkbench(view());

    expect(html).toContain('href="/admin?new=project">Add Project</a>');
    expect(html).toContain('href="/admin?new=blog_post">Add Blog post</a>');
    expect(html).not.toContain("Add Home");
    expect(html).not.toContain("Add About");
    expect(html).toContain(
      ".danger { border-color: #ff9b8f; color: #ff9b8f; }"
    );
  });

  test("each list is named by its section heading", () => {
    const html = renderWorkbench(view());

    expect(html).toContain('<h3 id="lib-pages">Pages</h3>');
    expect(html).toContain('<ul aria-labelledby="lib-pages">');
  });
});

describe("the tabbed reflow fallback", () => {
  test("panes are not labelled as tabpanels in the served markup", () => {
    // Only the markup. The stylesheet legitimately mentions `[role="tab"]`,
    // because it styles the state script applies later.
    const markup = renderWorkbench(view())
      .split("</style>")[1]!
      .split("<script>")[0]!;

    // All three panes are visible in the wide layout, so claiming a tab widget
    // here would describe a page that does not exist. Script adds the roles
    // only while the narrow media query matches.
    expect(markup).not.toContain('role="tabpanel"');
    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain('role="tab"');
  });

  test("every tab names the pane it controls", () => {
    const html = renderWorkbench(view());

    for (const pane of ["library", "editor", "preview"]) {
      expect(html).toContain(`data-pane="${pane}"`);
      expect(html).toContain(`id="tab-${pane}"`);
    }
  });
});

describe("announcements", () => {
  test("there is exactly one polite live region", () => {
    const html = renderWorkbench(view());

    expect(html.match(/aria-live=/g)).toHaveLength(1);
    expect(html).toContain('role="status" aria-live="polite"');
    // Clipped, not display:none — a hidden live region announces nothing.
    expect(html).toContain('class="visually-hidden"');
    expect(html).toContain("clip-path: inset(50%)");
  });
});

describe("escaping", () => {
  test("owner content cannot become markup", () => {
    const html = renderWorkbench(
      view({
        sections: [
          {
            id: "projects",
            label: "Projects",
            entries: [
              {
                id: "x",
                label: '<img src=x onerror="alert(1)">',
                route: "/projects/x",
                supportingText: '"><script>alert(2)</script>',
              },
            ],
          },
        ],
      })
    );

    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(2)");
    expect(html).toContain("&lt;img src=x");
  });

  test("the CSRF token is serialised, not interpolated raw", () => {
    const html = renderWorkbench(view({ csrfToken: "</script><script>x" }));

    // JSON does not escape `<`, so stringify alone would let the token close
    // the script element. The `\u003c` form is what stops it.
    expect(html).not.toContain("</script><script>x");
    expect(html).toContain("\\u003c/script>\\u003cscript>x");
    expect(escapeHtml("<&>")).toBe("&lt;&amp;&gt;");
  });
});

describe("status rail", () => {
  test("shows Content draft and Published revision state together", () => {
    const html = renderWorkbench(view());

    expect(html).toContain(
      '<dt>Content draft</dt><dd id="draft-status">Not opened</dd>'
    );
    expect(html).toContain("<dt>Published revision</dt><dd>None yet</dd>");
    expect(html).toContain(
      '<dt>Preview generation</dt><dd id="preview-generation">ready · abcdef12</dd>'
    );
  });
});
