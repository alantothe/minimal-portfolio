/**
 * Client-side SPA router for smooth page navigation
 *
 * NOTE: This is a JavaScript file (not TypeScript) because browsers cannot directly
 * execute TypeScript with type annotations and interfaces. Using plain JS here avoids
 * the need for a build step when making changes to the client-side router.
 */

class SPARouter {
  isNavigating = false;
  pagesLoaded = false;
  pagesData = null;

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
          this.switchPage(event.state.page, false);
        }
      }
    });

    // Pre-load all pages on init
    this.preloadAllPages().then(() => {
      const initialPath = window.location.pathname;
      const blogPostMatch = initialPath.match(/^\/blog\/([^/]+)$/);

      if (blogPostMatch) {
        const slug = blogPostMatch[1];
        window.history.replaceState({ page: 'blog-post', slug }, "", initialPath);
        this.loadBlogPost(slug, false);
      } else {
        const initialPage = this.getPageFromPath(initialPath);
        window.history.replaceState({ page: initialPage }, "", initialPath);
        this.switchPage(initialPage, false);
      }
    });
  }

  /**
   * Pre-load all 4 pages at startup
   */
  async preloadAllPages() {
    try {
      const response = await fetch('/api/pages');
      if (!response.ok) {
        throw new Error(`Failed to load pages: ${response.statusText}`);
      }
      const data = await response.json();
      this.pagesData = data.pages;

      // Populate all page containers with pre-loaded content
      Object.entries(this.pagesData).forEach(([pageName, pageData]) => {
        const containerId = `${pageName}-page`;
        const container = document.getElementById(containerId);
        if (container && pageData.content) {
          container.innerHTML = pageData.content;

          // Execute inline scripts and load external scripts (needed for blog listing)
          const scripts = container.querySelectorAll('script');
          const externalScripts = [];
          const inlineScripts = [];

          // Separate external and inline scripts
          scripts.forEach(oldScript => {
            if (oldScript.src) {
              externalScripts.push(oldScript);
            } else {
              inlineScripts.push(oldScript);
            }
          });

          // Load external scripts first, then execute inline scripts
          Promise.all(
            externalScripts.map(oldScript => {
              return new Promise((resolve, reject) => {
                const newScript = document.createElement('script');
                newScript.src = oldScript.src;

                // Copy any other attributes except src
                Array.from(oldScript.attributes).forEach(attr => {
                  if (attr.name !== 'src' && attr.name !== 'type') {
                    newScript.setAttribute(attr.name, attr.value);
                  }
                });

                newScript.onload = resolve;
                newScript.onerror = reject;

                oldScript.parentNode.replaceChild(newScript, oldScript);
              });
            })
          ).then(() => {
            // After external scripts load, execute inline scripts
            inlineScripts.forEach(oldScript => {
              const newScript = document.createElement('script');
              newScript.textContent = oldScript.textContent;

              // Copy any other attributes
              Array.from(oldScript.attributes).forEach(attr => {
                if (attr.name !== 'src' && attr.name !== 'type') {
                  newScript.setAttribute(attr.name, attr.value);
                }
              });

              oldScript.parentNode.replaceChild(newScript, oldScript);
            });
          }).catch(error => {
            console.error('[SPA Router] Error loading external scripts:', error);
            // Still execute inline scripts even if external scripts fail
            inlineScripts.forEach(oldScript => {
              const newScript = document.createElement('script');
              newScript.textContent = oldScript.textContent;
              oldScript.parentNode.replaceChild(newScript, oldScript);
            });
          });
        }
      });

      this.pagesLoaded = true;
    } catch (error) {
      console.error("[SPA Router] Error pre-loading pages:", error);
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
    await this.switchPage(page, true);
  }

  /**
   * Switch between pre-loaded pages with instant visibility toggle
   */
  async switchPage(pageName, addTransition) {
    this.isNavigating = true;
    try {
      // Hide all page containers
      document.querySelectorAll('.page-container').forEach(container => {
        container.classList.remove('active');
      });

      // Show the requested page
      const pageContainer = document.getElementById(`${pageName}-page`);
      if (pageContainer) {
        pageContainer.classList.add('active');
      }

      // Update page metadata
      if (this.pagesData && this.pagesData[pageName]) {
        const pageData = this.pagesData[pageName];
        document.title = pageData.title;
        this.updatePageCSS(pageData.pageCSS);
      }

      this.updateActiveNav(pageName);
    } catch (error) {
      console.error("[SPA Router] Error switching page:", error);
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
      const blogPostContainer = document.getElementById('blog-post-page');

      if (blogPostContainer && addTransition) {
        blogPostContainer.style.opacity = "0";
        blogPostContainer.style.transition = "opacity 0.15s ease-out";
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      const response = await fetch(`/api/blog/${slug}`);
      if (!response.ok) {
        throw new Error(`Failed to load blog post: ${response.statusText}`);
      }
      const data = await response.json();

      // Hide all pages and show blog-post-page
      document.querySelectorAll('.page-container').forEach(container => {
        container.classList.remove('active');
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
        blogPostContainer.classList.add('active');

        const backLink = blogPostContainer.querySelector('.back-to-blog');
        if (backLink) {
          backLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.history.pushState({ page: 'blog' }, '', '/blog');
            this.switchPage('blog', true);
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

      if (blogPostContainer && addTransition) {
        blogPostContainer.offsetWidth;
        blogPostContainer.style.opacity = "1";
      }
    } catch (error) {
      console.error("[SPA Router] Error loading blog post:", error);
      const blogPostContainer = document.getElementById('blog-post-page');
      if (blogPostContainer) {
        blogPostContainer.innerHTML = "<h1>Error loading post</h1><p>Please try again.</p>";
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
