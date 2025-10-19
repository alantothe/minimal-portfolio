/**
 * Client-side SPA router for smooth page navigation
 *
 * NOTE: This is a JavaScript file (not TypeScript) because browsers cannot directly
 * execute TypeScript with type annotations and interfaces. Using plain JS here avoids
 * the need for a build step when making changes to the client-side router.
 */

class SPARouter {
  isNavigating = false;
  constructor() {
    this.init();
  }
  init() {
    this.attachNavListeners();
    window.addEventListener("popstate", (event) => {
      if (event.state && event.state.page) {
        this.loadPage(event.state.page, false);
      }
    });
    const initialPage = this.getPageFromPath(window.location.pathname);
    window.history.replaceState({ page: initialPage }, "", window.location.pathname);
    this.loadPage(initialPage, false);
  }
  attachNavListeners() {
    document.addEventListener("click", (e) => {
      const target = e.target;
      const link = target.closest("a.nav-link");
      if (link) {
        e.preventDefault();
        e.stopPropagation();
        const url = new URL(link.href);
        const page = this.getPageFromPath(url.pathname);
        this.navigate(page, url.pathname);
        return false;
      }
    });
  }
  getPageFromPath(pathname) {
    if (pathname === "/" || pathname === "/home")
      return "home";
    return pathname.replace("/", "");
  }
  async navigate(page, path) {
    if (this.isNavigating) {
      return;
    }
    window.history.pushState({ page }, "", path);
    await this.loadPage(page, true);
  }
  async loadPage(pageName, addTransition) {
    this.isNavigating = true;
    try {
      const contentElement = document.getElementById("app-content");
      if (contentElement && addTransition) {
        contentElement.style.opacity = "0";
        contentElement.style.transition = "opacity 0.15s ease-out";
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      const response = await fetch(`/api/page?name=${pageName}`);
      if (!response.ok) {
        throw new Error(`Failed to load page: ${response.statusText}`);
      }
      const data = await response.json();
      if (contentElement) {
        contentElement.innerHTML = data.content;
      }
      document.title = data.title;
      this.updatePageCSS(data.pageCSS);
      this.updateActiveNav(pageName);
      if (contentElement && addTransition) {
        contentElement.offsetWidth;
        contentElement.style.opacity = "1";
      }
    } catch (error) {
      console.error("[SPA Router] Error loading page:", error);
      const contentElement = document.getElementById("app-content");
      if (contentElement) {
        contentElement.innerHTML = "<h1>Error loading page</h1><p>Please try again.</p>";
      }
    } finally {
      this.isNavigating = false;
    }
  }
  updatePageCSS(cssPath) {
    let pageCssLink = document.getElementById("page-css");
    if (!pageCssLink) {
      pageCssLink = document.createElement("link");
      pageCssLink.id = "page-css";
      pageCssLink.rel = "stylesheet";
      document.head.appendChild(pageCssLink);
    }
    pageCssLink.href = cssPath;
  }
  updateActiveNav(pageName) {
    const navLinks = document.querySelectorAll(".nav-link");
    navLinks.forEach((link) => {
      link.classList.remove("active");
      const linkHref = link.getAttribute("href");
      const linkPage = linkHref === "/" ? "home" : linkHref?.replace("/", "");
      if (linkPage === pageName || pageName === "home" && linkHref === "/") {
        link.classList.add("active");
      }
    });
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    new SPARouter;
  });
} else {
  new SPARouter;
}
