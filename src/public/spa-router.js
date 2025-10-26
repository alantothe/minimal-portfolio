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
    this.attachBlogPostListener();
    window.addEventListener("popstate", (event) => {
      if (event.state) {
        if (event.state.page === 'blog-post' && event.state.slug) {
          this.loadBlogPost(event.state.slug, false);
        } else if (event.state.page) {
          this.loadPage(event.state.page, false);
        }
      }
    });
    const initialPath = window.location.pathname;
    const blogPostMatch = initialPath.match(/^\/blog\/([^/]+)$/);

    if (blogPostMatch) {
      const slug = blogPostMatch[1];
      window.history.replaceState({ page: 'blog-post', slug }, "", initialPath);
      this.loadBlogPost(slug, false);
    } else {
      const initialPage = this.getPageFromPath(initialPath);
      window.history.replaceState({ page: initialPage }, "", initialPath);
      this.loadPage(initialPage, false);
    }
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

        // Execute inline scripts (needed for blog listing)
        const scripts = contentElement.querySelectorAll('script');
        scripts.forEach(oldScript => {
          const newScript = document.createElement('script');
          newScript.textContent = oldScript.textContent;
          oldScript.parentNode.replaceChild(newScript, oldScript);
        });
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
  updateMetaTags(metadata) {
    // Update or create description meta tag
    let descriptionMeta = document.querySelector('meta[name="description"]');
    if (!descriptionMeta) {
      descriptionMeta = document.createElement('meta');
      descriptionMeta.name = 'description';
      document.head.appendChild(descriptionMeta);
    }
    descriptionMeta.content = metadata.description;

    // Update or create article:published_time meta tag for SEO
    let publishedMeta = document.querySelector('meta[property="article:published_time"]');
    if (!publishedMeta) {
      publishedMeta = document.createElement('meta');
      publishedMeta.setAttribute('property', 'article:published_time');
      document.head.appendChild(publishedMeta);
    }
    publishedMeta.content = metadata.date;
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
  attachBlogPostListener() {
    window.addEventListener("navigate-to-post", (event) => {
      const { slug } = event.detail;
      this.loadBlogPost(slug, true);
    });
  }
  async loadBlogPost(slug, addTransition) {
    this.isNavigating = true;
    try {
      const contentElement = document.getElementById("app-content");
      if (contentElement && addTransition) {
        contentElement.style.opacity = "0";
        contentElement.style.transition = "opacity 0.15s ease-out";
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      const response = await fetch(`/api/blog/${slug}`);
      if (!response.ok) {
        throw new Error(`Failed to load blog post: ${response.statusText}`);
      }
      const data = await response.json();
      if (contentElement) {
        contentElement.innerHTML = `
          <article class="blog-post">
            <a href="/blog" class="back-to-blog back-link">&larr; Back to Blog</a>
            <div class="blog-post-content">
              ${data.html}
            </div>
          </article>
        `;
        const backLink = contentElement.querySelector('.back-to-blog');
        if (backLink) {
          backLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.history.pushState({ page: 'blog' }, '', '/blog');
            this.loadPage('blog', true);
          });
        }
      }
      document.title = `${data.metadata.title} - Blog - Portfolio`;

      // Update meta tags for SEO
      this.updateMetaTags({
        title: data.metadata.title,
        description: data.metadata.excerpt || '',
        date: data.metadata.date
      });

      this.updatePageCSS('/pages/blog/styles.css');
      this.updateActiveNav('blog');
      if (contentElement && addTransition) {
        contentElement.offsetWidth;
        contentElement.style.opacity = "1";
      }
    } catch (error) {
      console.error("[SPA Router] Error loading blog post:", error);
      const contentElement = document.getElementById("app-content");
      if (contentElement) {
        contentElement.innerHTML = "<h1>Error loading post</h1><p>Please try again.</p>";
      }
    } finally {
      this.isNavigating = false;
    }
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    new SPARouter;
  });
} else {
  new SPARouter;
}
