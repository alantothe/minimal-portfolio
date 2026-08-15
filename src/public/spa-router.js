/**
 * Client-side SPA router for smooth page navigation
 *
 * NOTE: This is a JavaScript file (not TypeScript) because browsers cannot directly
 * execute TypeScript with type annotations and interfaces. Using plain JS here avoids
 * the need for a build step when making changes to the client-side router.
 */

import {
  blogPostApiPath,
  collectionPath,
  getCollectionPage,
  isCollectionPage,
  pageCacheKey,
} from "./navigation-state.js";

class SPARouter {
  isNavigating = false;
  pagesData = {};
  mobileBreakpoint = 481; // Mobile is 480px and below
  previewRoute =
    typeof globalThis.__PORTFOLIO_PREVIEW_ROUTE__ === "string"
      ? globalThis.__PORTFOLIO_PREVIEW_ROUTE__
      : null;

  constructor() {
    this.init();
  }

  init() {
    if (this.previewRoute) {
      this.attachPreviewNavigation();
    } else {
      this.attachNavListeners();
      this.attachContentLinkListeners();
    }
    this.attachHamburgerListener();
    this.attachEmailListener();
    this.attachResizeListener();
    if (!this.previewRoute)
      window.addEventListener("popstate", (event) => {
        if (event.state) {
          if (event.state.page === "blog-post" && event.state.slug) {
            this.loadBlogPost(
              event.state.slug,
              false,
              event.state.returnPage || 1
            );
          } else if (event.state.page === "project" && event.state.slug) {
            this.loadProject(
              event.state.slug,
              false,
              event.state.returnPage || 1
            );
          } else if (event.state.page) {
            this.switchPage(event.state.page, event.state.pageNumber || 1);
          }
        }
      });

    const logicalUrl = new URL(
      this.previewRoute ||
        `${window.location.pathname}${window.location.search}`,
      window.location.origin
    );
    const initialRoute = this.getInitialRoute(
      logicalUrl.pathname,
      logicalUrl.search
    );
    if (!this.previewRoute) {
      window.history.replaceState(
        initialRoute,
        "",
        `${window.location.pathname}${window.location.search}`
      );
    }

    const activePage =
      initialRoute.page === "blog-post"
        ? "blog"
        : initialRoute.page === "project"
          ? "projects"
          : initialRoute.page;
    this.updateActiveNav(activePage);

    const initialContainer = document.querySelector(".page-container.active");
    if (initialContainer) {
      initialContainer.dataset.loaded = "true";
      initialContainer.dataset.pageNumber = String(
        initialRoute.pageNumber || 1
      );
    }
    if (["home", "about", "projects", "blog"].includes(initialRoute.page)) {
      const key = pageCacheKey(initialRoute.page, initialRoute.pageNumber || 1);
      this.pagesData[key] = { title: document.title };
    }
    if (
      !this.previewRoute &&
      initialRoute.page === "blog-post" &&
      initialRoute.slug
    ) {
      this.recordInitialBlogView(initialRoute.slug);
    }

    // SSR content is already complete. Reveal it without client fetches.
    document.querySelector(".container")?.classList.add("ready");
  }

  /**
   * Preview navigation reloads through the authenticated renderer. It must not
   * call the public JSON APIs: until cutover those intentionally still read
   * legacy content, which would make one frame show two different generations.
   */
  attachPreviewNavigation() {
    document.addEventListener(
      "click",
      (event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }

        const link = event.target.closest("a[href]");
        if (!link) return;

        const target = new URL(link.href, window.location.origin);
        if (target.origin !== window.location.origin) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        const publicRoute = `${target.pathname}${target.search}`;
        window.location.assign(
          `/admin/preview?route=${encodeURIComponent(publicRoute)}${target.hash}`
        );
      },
      { capture: true }
    );
  }

  getInitialRoute(pathname, search = "") {
    const blogPostMatch = pathname.match(/^\/blog\/([^/]+)$/);
    if (blogPostMatch) {
      return { page: "blog-post", slug: blogPostMatch[1] };
    }

    const projectMatch = pathname.match(/^\/projects\/([^/]+)$/);
    if (projectMatch) {
      return { page: "project", slug: projectMatch[1] };
    }

    const page = this.getPageFromPath(pathname);
    return {
      page,
      pageNumber: isCollectionPage(page) ? getCollectionPage(search) : 1,
    };
  }

  setPageContent(container, content) {
    container.innerHTML = content;
  }

  async loadPage(pageName, pageContainer, pageNumber = 1) {
    const query = new URLSearchParams({ name: pageName });
    if (isCollectionPage(pageName) && pageNumber > 1) {
      query.set("page", String(pageNumber));
    }
    const response = await fetch(`/api/page?${query}`);
    if (!response.ok) {
      throw new Error(`Failed to load ${pageName}: ${response.statusText}`);
    }

    const pageData = await response.json();
    this.setPageContent(pageContainer, pageData.content);
    pageContainer.dataset.loaded = "true";
    pageContainer.dataset.pageNumber = String(pageNumber);
    this.pagesData[pageCacheKey(pageName, pageNumber)] = pageData;
    return pageData;
  }

  attachNavListeners() {
    document.addEventListener("click", (e) => {
      const target = e.target;
      const link = target.closest("a.nav-link, a[data-spa-link]");
      if (link) {
        e.preventDefault();
        e.stopPropagation();
        const url = new URL(link.href);
        const page = this.getPageFromPath(url.pathname);
        this.navigate(page, url.pathname);
        // Close mobile nav after navigation
        this.closeMobileNav();
        return false;
      }
    });
  }

  attachContentLinkListeners() {
    document.addEventListener("click", (event) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const postLink = event.target.closest("a.post-link");
      if (postLink) {
        event.preventDefault();
        const slug = postLink.dataset.slug;
        const returnPage = getCollectionPage(window.location.search);
        window.history.pushState(
          { page: "blog-post", slug, returnPage },
          "",
          postLink.href
        );
        this.loadBlogPost(slug, true, returnPage);
        return;
      }

      const projectLink = event.target.closest("a.project-link");
      if (projectLink) {
        event.preventDefault();
        const slug = projectLink.dataset.projectId;
        const returnPage = getCollectionPage(window.location.search);
        window.history.pushState(
          { page: "project", slug, returnPage },
          "",
          projectLink.href
        );
        this.loadProject(slug, true, returnPage);
      }
    });
  }

  /**
   * Check if current viewport is in mobile breakpoint (480px and below)
   */
  isMobileBreakpoint() {
    return window.innerWidth < this.mobileBreakpoint;
  }

  /**
   * Attach resize listener to auto-close mobile nav when resizing to tablet+
   */
  attachResizeListener() {
    let resizeTimeout;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        // If resizing into tablet+ range and mobile nav is open, close it
        if (!this.isMobileBreakpoint()) {
          this.closeMobileNav();
        }
      }, 100);
    });
  }

  attachHamburgerListener() {
    const hamburger = document.getElementById("hamburger-toggle");
    const mobileNav = document.getElementById("mobile-nav");

    if (hamburger) {
      hamburger.addEventListener("click", () => {
        // Only allow toggle if in mobile breakpoint
        if (this.isMobileBreakpoint()) {
          hamburger.classList.toggle("active");
          mobileNav.classList.toggle("active");
        }
      });
    }
  }

  closeMobileNav() {
    const hamburger = document.getElementById("hamburger-toggle");
    const mobileNav = document.getElementById("mobile-nav");

    if (hamburger && mobileNav) {
      hamburger.classList.remove("active");
      mobileNav.classList.remove("active");
    }
  }

  getPageFromPath(pathname) {
    if (pathname === "/" || pathname === "/home") return "home";
    return pathname.replace("/", "");
  }

  async navigate(page, path) {
    if (this.isNavigating) {
      return;
    }
    window.history.pushState({ page, pageNumber: 1 }, "", path);
    await this.switchPage(page, 1);
  }

  /** Fetch on every navigation so a newly published generation is observed. */
  async switchPage(pageName, pageNumber = 1) {
    this.isNavigating = true;
    try {
      const pageContainer = document.getElementById(`${pageName}-page`);
      if (!pageContainer) {
        throw new Error(`Unknown page: ${pageName}`);
      }

      const pageData = await this.loadPage(pageName, pageContainer, pageNumber);

      await this.updatePageCSS(pageData.pageCSS);

      document.querySelectorAll(".page-container").forEach((container) => {
        container.classList.remove("active");
      });
      pageContainer.classList.add("active");

      if (pageData?.seo) {
        this.applySeoMetadata(pageData.seo);
      } else if (pageData) {
        document.title = pageData.title;
      }

      this.updateActiveNav(pageName);
    } catch (error) {
      console.error("[SPA Router] Error switching page:", error);
    } finally {
      this.isNavigating = false;
    }
  }
  async updatePageCSS(cssPath) {
    if (!cssPath) {
      return;
    }

    const currentLink = document.getElementById("page-css");
    if (currentLink && new URL(currentLink.href).pathname === cssPath) {
      return;
    }

    const nextLink = document.createElement("link");
    nextLink.rel = "stylesheet";
    nextLink.href = cssPath;

    await new Promise((resolve, reject) => {
      nextLink.addEventListener("load", resolve, { once: true });
      nextLink.addEventListener("error", reject, { once: true });
      document.head.appendChild(nextLink);
    });

    currentLink?.remove();
    nextLink.id = "page-css";
  }
  applySeoMetadata(metadata) {
    document.title = metadata.title;

    const setMeta = (attribute, name, content) => {
      let element = document.querySelector(`meta[${attribute}="${name}"]`);
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attribute, name);
        document.head.appendChild(element);
      }
      element.content = content;
    };

    setMeta("name", "description", metadata.description);
    setMeta("property", "og:site_name", metadata.siteName);
    setMeta("property", "og:type", metadata.type);
    setMeta("property", "og:title", metadata.title);
    setMeta("property", "og:description", metadata.description);
    setMeta("property", "og:url", metadata.canonical);
    setMeta("property", "og:image", metadata.image);
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", metadata.title);
    setMeta("name", "twitter:description", metadata.description);
    setMeta("name", "twitter:image", metadata.image);

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = metadata.canonical;

    const published = document.querySelector(
      'meta[property="article:published_time"]'
    );
    if (metadata.publishedTime) {
      setMeta("property", "article:published_time", metadata.publishedTime);
    } else {
      published?.remove();
    }

    let structuredData = document.querySelector(
      'script[type="application/ld+json"]'
    );
    if (metadata.structuredData) {
      if (!structuredData) {
        structuredData = document.createElement("script");
        structuredData.type = "application/ld+json";
        document.head.appendChild(structuredData);
      }
      structuredData.textContent = JSON.stringify(metadata.structuredData);
    } else {
      structuredData?.remove();
    }
  }
  updateActiveNav(pageName) {
    const navLinks = document.querySelectorAll(".nav-link");
    navLinks.forEach((link) => {
      link.classList.remove("active");
      const linkHref = link.getAttribute("href");
      const linkPage = linkHref === "/" ? "home" : linkHref?.replace("/", "");
      if (linkPage === pageName || (pageName === "home" && linkHref === "/")) {
        link.classList.add("active");
      }
    });
  }

  attachEmailListener() {
    document.addEventListener("click", (e) => {
      const emailElement = e.target.closest("#copy-email");
      if (emailElement) {
        e.preventDefault();
        e.stopPropagation();

        const email = emailElement.getAttribute("data-email");
        if (email) {
          // Copy to clipboard
          navigator.clipboard
            .writeText(email)
            .then(() => {
              // Create or get tooltip
              let tooltip = emailElement.querySelector("#copy-tooltip");
              if (!tooltip) {
                tooltip = document.createElement("span");
                tooltip.id = "copy-tooltip";
                tooltip.textContent = "Email copied to clipboard";
                emailElement.appendChild(tooltip);
              }

              // Show tooltip
              tooltip.classList.add("show");

              // Auto-hide after 1 second
              setTimeout(() => {
                tooltip.classList.remove("show");
              }, 1000);
            })
            .catch((err) => {
              console.error("[SPA Router] Failed to copy email:", err);
            });
        }
        return false;
      }
    });
  }

  getViewedPosts() {
    try {
      return JSON.parse(localStorage.getItem("viewedBlogPosts") || "{}");
    } catch {
      return {};
    }
  }

  saveViewedPost(slug, viewedPosts) {
    try {
      viewedPosts[slug] = true;
      localStorage.setItem("viewedBlogPosts", JSON.stringify(viewedPosts));
    } catch {
      // View tracking must never block navigation.
    }
  }

  getVisitorId() {
    try {
      const existing = localStorage.getItem("portfolioVisitorId");
      if (existing) {
        return existing;
      }

      const visitorId = crypto.randomUUID();
      localStorage.setItem("portfolioVisitorId", visitorId);
      return visitorId;
    } catch {
      return crypto.randomUUID();
    }
  }

  async recordInitialBlogView(slug) {
    const viewedPosts = this.getViewedPosts();
    if (viewedPosts[slug] === true) {
      return;
    }

    try {
      const response = await fetch(blogPostApiPath(slug, this.getVisitorId()));
      if (response.ok) {
        this.saveViewedPost(slug, viewedPosts);
      }
    } catch {
      // Analytics failure must not affect the server-rendered page.
    }
  }

  async loadBlogPost(slug, addTransition, returnPage = 1) {
    this.isNavigating = true;
    try {
      const blogPostContainer = document.getElementById("blog-post-page");

      if (blogPostContainer && addTransition) {
        blogPostContainer.style.opacity = "0";
        blogPostContainer.style.transition = "opacity 0.15s ease-out";
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      const viewedPosts = this.getViewedPosts();
      const hasBeenViewed = viewedPosts[slug] === true;
      const response = await fetch(
        blogPostApiPath(slug, hasBeenViewed ? undefined : this.getVisitorId())
      );
      if (!response.ok) {
        throw new Error(`Failed to load blog post: ${response.statusText}`);
      }
      const data = await response.json();
      await this.updatePageCSS("/pages/blog/styles.css");

      if (!hasBeenViewed) {
        this.saveViewedPost(slug, viewedPosts);
      }

      // Hide all pages and show blog-post-page
      document.querySelectorAll(".page-container").forEach((container) => {
        container.classList.remove("active");
      });

      if (blogPostContainer) {
        blogPostContainer.innerHTML = `
          <article class="blog-post">
            <a href="/blog" class="back-to-blog back-link">&larr; Back to Blog</a>
            <div class="blog-post-content">
              ${data.html}
            </div>
          </article>
        `;
        blogPostContainer.classList.add("active");

        const backLink = blogPostContainer.querySelector(".back-to-blog");
        if (backLink) {
          backLink.addEventListener("click", (e) => {
            e.preventDefault();
            const backUrl = collectionPath("blog", returnPage);
            window.history.pushState(
              { page: "blog", pageNumber: returnPage },
              "",
              backUrl
            );
            this.switchPage("blog", returnPage);
          });
        }
      }

      this.applySeoMetadata(data.seo);

      this.updateActiveNav("blog");

      if (blogPostContainer && addTransition) {
        // Trigger reflow for CSS transition (CSS transition uses opacity)
        void blogPostContainer.offsetWidth;
        blogPostContainer.style.opacity = "1";
      }
    } catch (error) {
      console.error("[SPA Router] Error loading blog post:", error);
      const blogPostContainer = document.getElementById("blog-post-page");
      if (blogPostContainer) {
        blogPostContainer.innerHTML =
          "<h1>Error loading post</h1><p>Please try again.</p>";
      }
    } finally {
      this.isNavigating = false;
    }
  }

  async loadProject(slug, addTransition, returnPage = 1) {
    this.isNavigating = true;
    try {
      const projectContainer = document.getElementById("project-page");

      if (projectContainer && addTransition) {
        projectContainer.style.opacity = "0";
        projectContainer.style.transition = "opacity 0.15s ease-out";
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      const response = await fetch(`/api/projects/${slug}`);
      if (!response.ok) {
        throw new Error(`Failed to load project: ${response.statusText}`);
      }
      const data = await response.json();
      await this.updatePageCSS("/pages/projects/styles.css");

      // Hide all pages and show project-page
      document.querySelectorAll(".page-container").forEach((container) => {
        container.classList.remove("active");
      });

      if (projectContainer) {
        projectContainer.innerHTML = `
          <div class="project-page-shell">
            <a href="/projects" class="back-to-projects back-link">&larr; All projects</a>
            ${data.html}
          </div>
        `;
        projectContainer.classList.add("active");

        const backLink = projectContainer.querySelector(".back-to-projects");
        if (backLink) {
          backLink.addEventListener("click", (e) => {
            e.preventDefault();
            const backUrl = collectionPath("projects", returnPage);
            window.history.pushState(
              { page: "projects", pageNumber: returnPage },
              "",
              backUrl
            );
            this.switchPage("projects", returnPage);
          });
        }
      }

      this.applySeoMetadata(data.seo);

      this.updateActiveNav("projects");

      if (projectContainer && addTransition) {
        // Trigger reflow for CSS transition (CSS transition uses opacity)
        void projectContainer.offsetWidth;
        projectContainer.style.opacity = "1";
      }
    } catch (error) {
      console.error("[SPA Router] Error loading project:", error);
      const projectContainer = document.getElementById("project-page");
      if (projectContainer) {
        projectContainer.innerHTML =
          "<h1>Error loading project</h1><p>Please try again.</p>";
      }
    } finally {
      this.isNavigating = false;
    }
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    new SPARouter();
  });
} else {
  new SPARouter();
}
