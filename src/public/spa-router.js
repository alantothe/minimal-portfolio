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
import {
  canFinishMobilePageSwipe,
  canStartMobilePageSwipe,
  createMobilePageSwipeRecognizer,
  getMobilePageBoundaryCues,
} from "./mobile-page-navigation.js";

const MOBILE_SWIPE_INTERACTIVE_SELECTOR =
  "a, button, input, textarea, select, summary, dialog, [role='button'], [role='dialog'], [contenteditable='true'], [data-mobile-swipe-ignore]";

const MOBILE_PAGE_TRANSITIONS = {
  next: {
    exitClass: "mobile-page-exit-next",
    exitDuration: 140,
    enterClass: "mobile-page-enter-next",
    enterDuration: 220,
  },
  previous: {
    exitClass: "mobile-page-exit-previous",
    exitDuration: 140,
    enterClass: "mobile-page-enter-previous",
    enterDuration: 220,
  },
};

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
    this.attachMobileMenuListener();
    this.attachEmailListener();
    this.attachResizeListener();
    this.attachOuterWheelListener();
    this.attachMobilePageSwipeNavigation();
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

    this.setupProjectMedia(document);

    // SSR content is already complete. Reveal it without client fetches.
    document.querySelector(".container")?.classList.add("ready");
    requestAnimationFrame(() => this.refreshMobilePageCues());
  }

  setupProjectMedia(root) {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    root.querySelectorAll("[data-project-media]").forEach((carousel) => {
      if (carousel.dataset.projectMediaReady === "true") return;
      carousel.dataset.projectMediaReady = "true";

      const slides = Array.from(
        carousel.querySelectorAll("[data-project-media-slide]")
      );
      const dots = Array.from(
        carousel.querySelectorAll("[data-project-media-dot]")
      );
      if (slides.length < 2) return;

      let current = Math.max(
        0,
        slides.findIndex((slide) => slide.dataset.active === "true")
      );
      let timer = null;
      let paused = false;

      const show = (index) => {
        current = (index + slides.length) % slides.length;
        slides.forEach((slide, slideIndex) => {
          if (slideIndex === current) slide.dataset.active = "true";
          else delete slide.dataset.active;
        });
        dots.forEach((dot, dotIndex) => {
          if (dotIndex === current) dot.setAttribute("aria-current", "true");
          else dot.removeAttribute("aria-current");
        });
      };

      const stop = () => {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
      };

      const start = () => {
        stop();
        if (
          reducedMotion ||
          paused ||
          carousel.dataset.autoplay !== "true" ||
          !carousel.isConnected
        ) {
          return;
        }
        timer = window.setInterval(() => {
          if (!carousel.isConnected) {
            stop();
            return;
          }
          show(current + 1);
        }, 6000);
      };

      carousel
        .querySelector("[data-project-media-previous]")
        ?.addEventListener("click", () => {
          show(current - 1);
          start();
        });
      carousel
        .querySelector("[data-project-media-next]")
        ?.addEventListener("click", () => {
          show(current + 1);
          start();
        });
      dots.forEach((dot) => {
        dot.addEventListener("click", () => {
          show(Number(dot.dataset.projectMediaDot));
          start();
        });
      });

      carousel.addEventListener("pointerenter", () => {
        paused = true;
        stop();
      });
      carousel.addEventListener("pointerleave", () => {
        paused = false;
        start();
      });
      carousel.addEventListener("focusin", () => {
        paused = true;
        stop();
      });
      carousel.addEventListener("focusout", (event) => {
        if (carousel.contains(event.relatedTarget)) return;
        paused = false;
        start();
      });
      carousel.querySelector("video")?.addEventListener("play", stop);

      start();
    });
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
        this.refreshMobilePageCues();
      }, 100);
    });
  }

  attachOuterWheelListener() {
    document.addEventListener(
      "wheel",
      (event) => {
        if (event.ctrlKey || event.deltaY === 0) {
          return;
        }

        const target = event.target;
        if (
          target instanceof Element &&
          (target.closest("#app-content") || target.closest('[role="dialog"]'))
        ) {
          return;
        }

        const content = document.getElementById("app-content");
        if (!content) {
          return;
        }

        const lineHeight =
          Number.parseFloat(getComputedStyle(content).lineHeight) || 16;
        const deltaScale =
          event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? lineHeight
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? content.clientHeight
              : 1;

        content.scrollTop += event.deltaY * deltaScale;
        event.preventDefault();
      },
      { passive: false }
    );
  }

  attachMobilePageSwipeNavigation() {
    if (this.previewRoute) {
      return;
    }

    const content = document.getElementById("app-content");
    if (!content) {
      return;
    }

    const recognizer = createMobilePageSwipeRecognizer();
    const cancelGesture = () => recognizer.cancel();

    content.addEventListener(
      "touchstart",
      (event) => {
        const target = event.target;
        const mobileNav = document.getElementById("mobile-nav");
        const isBlockedTarget =
          target instanceof Element &&
          Boolean(target.closest(MOBILE_SWIPE_INTERACTIVE_SELECTOR));

        const canStart = canStartMobilePageSwipe({
          isMobile: this.isMobileBreakpoint(),
          isNavigating: this.isNavigating,
          touchCount: event.touches.length,
          menuOpen: Boolean(mobileNav?.classList.contains("active")),
          dialogOpen: Boolean(document.querySelector("dialog[open]")),
          targetIsInteractive: isBlockedTarget,
        });

        if (!canStart) {
          cancelGesture();
          return;
        }

        const touch = event.touches[0];
        recognizer.start({
          x: touch.clientX,
          y: touch.clientY,
          scrollTop: content.scrollTop,
          scrollHeight: content.scrollHeight,
          clientHeight: content.clientHeight,
        });
      },
      { passive: true }
    );

    content.addEventListener(
      "touchend",
      (event) => {
        const canFinish = canFinishMobilePageSwipe({
          isMobile: this.isMobileBreakpoint(),
          isNavigating: this.isNavigating,
          changedTouchCount: event.changedTouches.length,
          remainingTouchCount: event.touches.length,
        });

        if (!canFinish) {
          cancelGesture();
          return;
        }

        const touch = event.changedTouches[0];
        const navigation = recognizer.finish({
          x: touch.clientX,
          y: touch.clientY,
          pageName: this.getCurrentPageName(),
          now: performance.now(),
        });

        if (!navigation) {
          return;
        }

        const path =
          navigation.pageName === "home" ? "/" : `/${navigation.pageName}`;
        void this.navigate(navigation.pageName, path, navigation.intent);
      },
      { passive: true }
    );

    document.addEventListener(
      "touchstart",
      (event) => {
        if (event.touches.length !== 1) {
          cancelGesture();
        }
      },
      { passive: true, capture: true }
    );
    document.addEventListener("touchcancel", cancelGesture, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", () => {
      if (!this.isMobileBreakpoint()) {
        cancelGesture();
      }
    });
    content.addEventListener("scroll", () => this.refreshMobilePageCues(), {
      passive: true,
    });

    const dialogObserver = new MutationObserver((mutations) => {
      if (
        mutations.some(
          ({ target }) =>
            target instanceof Element && target.tagName === "DIALOG"
        )
      ) {
        this.refreshMobilePageCues();
      }
    });
    dialogObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["open"],
      subtree: true,
    });
  }

  attachMobileMenuListener() {
    const menuToggle = document.getElementById("mobile-menu-toggle");
    const mobileNav = document.getElementById("mobile-nav");

    if (menuToggle) {
      menuToggle.addEventListener("click", () => {
        // Only allow toggle if in mobile breakpoint
        if (this.isMobileBreakpoint() && mobileNav) {
          const isOpen = menuToggle.classList.toggle("active");
          mobileNav.classList.toggle("active", isOpen);
          menuToggle.setAttribute("aria-expanded", String(isOpen));
          this.refreshMobilePageCues();
        }
      });
    }
  }

  closeMobileNav() {
    const menuToggle = document.getElementById("mobile-menu-toggle");
    const mobileNav = document.getElementById("mobile-nav");

    if (menuToggle && mobileNav) {
      menuToggle.classList.remove("active");
      mobileNav.classList.remove("active");
      menuToggle.setAttribute("aria-expanded", "false");
      this.refreshMobilePageCues();
    }
  }

  getCurrentPageName() {
    const statePage = window.history.state?.page;
    return typeof statePage === "string"
      ? statePage
      : this.getInitialRoute(window.location.pathname, window.location.search)
          .page;
  }

  refreshMobilePageCues() {
    const nextCue = document.getElementById("mobile-page-cue-next");
    const content = document.getElementById("app-content");
    const mobileNav = document.getElementById("mobile-nav");
    if (!nextCue || !content) {
      return;
    }

    if (
      this.previewRoute ||
      !this.isMobileBreakpoint() ||
      this.isNavigating ||
      mobileNav?.classList.contains("active") ||
      document.querySelector("dialog[open]")
    ) {
      nextCue.classList.remove("visible");
      return;
    }

    const cues = getMobilePageBoundaryCues(this.getCurrentPageName(), {
      scrollTop: content.scrollTop,
      scrollHeight: content.scrollHeight,
      clientHeight: content.clientHeight,
    });
    const setNextCue = (pageName) => {
      if (!pageName) {
        nextCue.textContent = "";
        delete nextCue.dataset.destination;
        nextCue.classList.remove("visible");
        return;
      }

      const label = pageName[0].toUpperCase() + pageName.slice(1);
      nextCue.textContent = "Swipe up";
      nextCue.dataset.destination = label;
      nextCue.classList.add("visible");
    };

    setNextCue(cues.next);
  }

  getPageFromPath(pathname) {
    if (pathname === "/" || pathname === "/home") return "home";
    return pathname.replace("/", "");
  }

  async navigate(page, path, transitionDirection = null) {
    if (this.isNavigating) {
      return;
    }
    const didSwitch = await this.switchPage(page, 1, transitionDirection);
    if (didSwitch) {
      window.history.pushState({ page, pageNumber: 1 }, "", path);
      this.refreshMobilePageCues();
    }
  }

  resetContentScroll() {
    const content = document.getElementById("app-content");
    if (content) {
      content.scrollTop = 0;
    }
  }

  setNavigating(isNavigating) {
    this.isNavigating = isNavigating;
    this.refreshMobilePageCues();
  }

  /** Revalidate database-backed pages; retain legacy navigation until cutover. */
  async switchPage(pageName, pageNumber = 1, transitionDirection = null) {
    this.setNavigating(true);
    let pageCSS = {
      activate: () => {},
      cleanup: () => {},
    };
    try {
      const pageContainer = document.getElementById(`${pageName}-page`);
      if (!pageContainer) {
        throw new Error(`Unknown page: ${pageName}`);
      }

      const cacheKey = pageCacheKey(pageName, pageNumber);
      const cachedPage = this.pagesData[cacheKey];
      const publishedSite = Boolean(
        document.documentElement.dataset.publicationGeneration
      );
      const pageData =
        publishedSite ||
        pageContainer.dataset.loaded !== "true" ||
        Number(pageContainer.dataset.pageNumber || 1) !== pageNumber ||
        !cachedPage?.seo
          ? await this.loadPage(pageName, pageContainer, pageNumber)
          : cachedPage;

      pageCSS = await this.preparePageCSS(pageData.pageCSS);
      await this.activatePageContainer(
        pageContainer,
        transitionDirection,
        pageCSS.activate
      );

      if (pageData?.seo) {
        this.applySeoMetadata(pageData.seo);
      } else if (pageData) {
        document.title = pageData.title;
      }

      this.updateActiveNav(pageName);
      return true;
    } catch (error) {
      console.error("[SPA Router] Error switching page:", error);
      return false;
    } finally {
      pageCSS.cleanup();
      this.setNavigating(false);
    }
  }
  shouldAnimateMobilePageTransition(direction) {
    return (
      Boolean(MOBILE_PAGE_TRANSITIONS[direction]) &&
      this.isMobileBreakpoint() &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  async animateMobilePageContainer(element, className, duration) {
    element.classList.add(className);
    await new Promise((resolve) => {
      let timeoutId;
      const finish = () => {
        clearTimeout(timeoutId);
        element.removeEventListener("animationend", onAnimationEnd);
        resolve();
      };
      const onAnimationEnd = (event) => {
        if (event.target === element) {
          finish();
        }
      };

      element.addEventListener("animationend", onAnimationEnd);
      timeoutId = setTimeout(finish, duration + 80);
    });
    element.classList.remove(className);
  }

  async activatePageContainer(pageContainer, direction, beforeSwap = () => {}) {
    const currentContainer = document.querySelector(".page-container.active");
    const transition =
      currentContainer &&
      currentContainer !== pageContainer &&
      this.shouldAnimateMobilePageTransition(direction)
        ? MOBILE_PAGE_TRANSITIONS[direction]
        : null;

    if (transition) {
      await this.animateMobilePageContainer(
        currentContainer,
        transition.exitClass,
        transition.exitDuration
      );
    }

    beforeSwap();
    document.querySelectorAll(".page-container").forEach((container) => {
      container.classList.remove("active");
    });
    pageContainer.classList.add("active");
    this.resetContentScroll();

    if (transition) {
      await this.animateMobilePageContainer(
        pageContainer,
        transition.enterClass,
        transition.enterDuration
      );
    }
  }

  async preparePageCSS(cssPath) {
    const noChange = {
      activate: () => {},
      cleanup: () => {},
    };
    if (!cssPath) {
      return noChange;
    }

    const currentLink = document.getElementById("page-css");
    if (currentLink) {
      const currentUrl = new URL(currentLink.href);
      if (`${currentUrl.pathname}${currentUrl.search}` === cssPath) {
        return noChange;
      }
    }

    const nextLink = document.createElement("link");
    nextLink.rel = "stylesheet";
    nextLink.href = cssPath;
    nextLink.media = "not all";

    try {
      await new Promise((resolve, reject) => {
        nextLink.addEventListener("load", resolve, { once: true });
        nextLink.addEventListener("error", reject, { once: true });
        document.head.appendChild(nextLink);
      });
    } catch (error) {
      nextLink.remove();
      throw error;
    }

    let activated = false;
    return {
      activate: () => {
        nextLink.media = "all";
        currentLink?.remove();
        nextLink.id = "page-css";
        activated = true;
      },
      cleanup: () => {
        if (!activated) {
          nextLink.remove();
        }
      },
    };
  }

  async updatePageCSS(cssPath) {
    const pageCSS = await this.preparePageCSS(cssPath);
    pageCSS.activate();
    return pageCSS.cleanup;
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
    this.setNavigating(true);
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
        this.resetContentScroll();

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
      this.setNavigating(false);
    }
  }

  async loadProject(slug, addTransition, returnPage = 1) {
    this.setNavigating(true);
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
      await this.updatePageCSS(
        "/pages/projects/styles.css?v=project-card-border-v2"
      );

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
        this.resetContentScroll();
        this.setupProjectMedia(projectContainer);

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
      this.setNavigating(false);
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
