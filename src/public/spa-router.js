/**
 * Client-side SPA router for smooth page navigation
 *
 * NOTE: This is a JavaScript file (not TypeScript) because browsers cannot directly
 * execute TypeScript with type annotations and interfaces. Using plain JS here avoids
 * the need for a build step when making changes to the client-side router.
 */

class SPARouter {
  isNavigating = false;
  pagesData = {};
  currentBlogPage = '1'; // Track current blog page for back navigation
  mobileBreakpoint = 481; // Mobile is 480px and below

  constructor() {
    this.init();
  }

  init() {
    this.attachNavListeners();
    this.attachHamburgerListener();
    this.attachBlogPostListener();
    this.attachProjectListener();
    this.attachEmailListener();
    this.attachResizeListener();
    window.addEventListener("popstate", (event) => {
      if (event.state) {
        if (event.state.page === 'blog-post' && event.state.slug) {
          this.loadBlogPost(event.state.slug, false);
        } else if (event.state.page === 'project' && event.state.slug) {
          this.loadProject(event.state.slug, false);
        } else if (event.state.page) {
          this.switchPage(event.state.page);
        }
      }
    });

    const initialRoute = this.getInitialRoute(window.location.pathname);
    window.history.replaceState(
      initialRoute,
      "",
      `${window.location.pathname}${window.location.search}`,
    );

    const activePage = initialRoute.page === 'blog-post'
      ? 'blog'
      : initialRoute.page === 'project'
        ? 'projects'
        : initialRoute.page;
    this.updateActiveNav(activePage);

    const initialContainer = document.querySelector('.page-container.active');
    if (initialContainer) {
      initialContainer.dataset.loaded = 'true';
    }
    if (['home', 'about', 'projects', 'blog'].includes(initialRoute.page)) {
      this.pagesData[initialRoute.page] = { title: document.title };
    }

    // SSR content is already complete. Reveal it without client fetches.
    document.querySelector('.container')?.classList.add('ready');
  }

  getInitialRoute(pathname) {
    const blogPostMatch = pathname.match(/^\/blog\/([^/]+)$/);
    if (blogPostMatch) {
      return { page: 'blog-post', slug: blogPostMatch[1] };
    }

    const projectMatch = pathname.match(/^\/projects\/([^/]+)$/);
    if (projectMatch) {
      return { page: 'project', slug: projectMatch[1] };
    }

    return { page: this.getPageFromPath(pathname) };
  }

  async setPageContent(container, content) {
    container.innerHTML = content;
    const scripts = Array.from(container.querySelectorAll('script'));
    const externalScripts = scripts.filter(script => script.src);
    const inlineScripts = scripts.filter(script => !script.src);

    await Promise.all(externalScripts.map(oldScript => new Promise((resolve, reject) => {
      const newScript = document.createElement('script');
      newScript.src = oldScript.src;

      Array.from(oldScript.attributes).forEach(attr => {
        if (attr.name !== 'src' && attr.name !== 'type') {
          newScript.setAttribute(attr.name, attr.value);
        }
      });

      newScript.onload = resolve;
      newScript.onerror = reject;
      oldScript.parentNode.replaceChild(newScript, oldScript);
    })));

    inlineScripts.forEach(oldScript => {
      const newScript = document.createElement('script');
      newScript.textContent = oldScript.textContent;
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
  }

  async loadPage(pageName, pageContainer) {
    const response = await fetch(`/api/page?name=${encodeURIComponent(pageName)}`);
    if (!response.ok) {
      throw new Error(`Failed to load ${pageName}: ${response.statusText}`);
    }

    const pageData = await response.json();
    await this.setPageContent(pageContainer, pageData.content);
    pageContainer.dataset.loaded = 'true';
    this.pagesData[pageName] = pageData;
    return pageData;
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
        // Close mobile nav after navigation
        this.closeMobileNav();
        return false;
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
    window.addEventListener('resize', () => {
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
    const hamburger = document.getElementById('hamburger-toggle');
    const mobileNav = document.getElementById('mobile-nav');

    if (hamburger) {
      hamburger.addEventListener('click', () => {
        // Only allow toggle if in mobile breakpoint
        if (this.isMobileBreakpoint()) {
          hamburger.classList.toggle('active');
          mobileNav.classList.toggle('active');
        }
      });
    }
  }

  closeMobileNav() {
    const hamburger = document.getElementById('hamburger-toggle');
    const mobileNav = document.getElementById('mobile-nav');

    if (hamburger && mobileNav) {
      hamburger.classList.remove('active');
      mobileNav.classList.remove('active');
    }
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
    await this.switchPage(page);
  }

  /**
   * Fetch a page fragment on first navigation, then switch cached containers.
   */
  async switchPage(pageName) {
    this.isNavigating = true;
    try {
      const pageContainer = document.getElementById(`${pageName}-page`);
      if (!pageContainer) {
        throw new Error(`Unknown page: ${pageName}`);
      }

      const pageData = pageContainer.dataset.loaded === 'true'
        ? this.pagesData[pageName]
        : await this.loadPage(pageName, pageContainer);

      document.querySelectorAll('.page-container').forEach(container => {
        container.classList.remove('active');
      });
      pageContainer.classList.add('active');

      if (pageData) {
        document.title = pageData.title;
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
      // Capture current blog page before navigating to post
      this.currentBlogPage = this.getBlogPageFromURL();
      console.log('[SPA Router] Navigating to post - captured currentBlogPage:', this.currentBlogPage, 'from URL:', window.location.search);
      this.loadBlogPost(slug, true);
    });
  }

  attachProjectListener() {
    window.addEventListener("navigate-to-project", (event) => {
      const { slug } = event.detail;
      this.loadProject(slug, true);
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
          navigator.clipboard.writeText(email).then(() => {
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
          }).catch(err => {
            console.error("[SPA Router] Failed to copy email:", err);
          });
        }
        return false;
      }
    });
  }

  getBlogPageFromURL() {
    // Extract page number from current URL (e.g., /blog?page=2 -> 2)
    const params = new URLSearchParams(window.location.search);
    return params.get('page') || '1';
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

      // Check if this post was already viewed in this session
      const viewedPosts = JSON.parse(localStorage.getItem('viewedBlogPosts') || '{}');
      const hasBeenViewed = viewedPosts[slug] === true;

      const response = await fetch(`/api/blog/${slug}`);
      if (!response.ok) {
        throw new Error(`Failed to load blog post: ${response.statusText}`);
      }
      const data = await response.json();

      // Mark as viewed in localStorage (prevents re-counting on refresh)
      if (!hasBeenViewed) {
        viewedPosts[slug] = true;
        localStorage.setItem('viewedBlogPosts', JSON.stringify(viewedPosts));
      }

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
            // Return to the blog page with the page number preserved
            const pageParam = this.currentBlogPage ? `?page=${this.currentBlogPage}` : '';
            const backUrl = `/blog${pageParam}`;
            console.log('[SPA Router] Back to blog - currentBlogPage:', this.currentBlogPage, 'backUrl:', backUrl);
            window.history.pushState({ page: 'blog' }, '', backUrl);
            this.switchPage('blog');
          });
        }
      }

      document.title = `${data.metadata.title} - Blog - Portfolio`;

      // Update meta tags for SEO
      this.updateMetaTags({
        description: data.metadata.excerpt || '',
        date: data.metadata.date
      });

      // All CSS files are preloaded in shell.html, no need to switch
      this.updateActiveNav('blog');

      if (blogPostContainer && addTransition) {
        // Trigger reflow for CSS transition (CSS transition uses opacity)
        void blogPostContainer.offsetWidth;
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

  async loadProject(slug, addTransition) {
    this.isNavigating = true;
    try {
      const projectContainer = document.getElementById('project-page');

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

      // Hide all pages and show project-page
      document.querySelectorAll('.page-container').forEach(container => {
        container.classList.remove('active');
      });

      if (projectContainer) {
        projectContainer.innerHTML = `
          <article class="project">
            <a href="/projects" class="back-to-projects back-link">&larr; Back to Projects</a>
            <div class="project-content">
              ${data.html}
            </div>
          </article>
        `;
        projectContainer.classList.add('active');

        const backLink = projectContainer.querySelector('.back-to-projects');
        if (backLink) {
          backLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.history.pushState({ page: 'projects' }, '', '/projects');
            this.switchPage('projects');
          });
        }
      }

      document.title = `${data.metadata.title} - Portfolio`;

      // Update meta tags for SEO
      this.updateMetaTags({
        description: data.metadata.description || '',
        date: data.metadata.date || ''
      });

      // All CSS files are preloaded in shell.html, no need to switch
      this.updateActiveNav('projects');

      if (projectContainer && addTransition) {
        // Trigger reflow for CSS transition (CSS transition uses opacity)
        void projectContainer.offsetWidth;
        projectContainer.style.opacity = "1";
      }
    } catch (error) {
      console.error("[SPA Router] Error loading project:", error);
      const projectContainer = document.getElementById('project-page');
      if (projectContainer) {
        projectContainer.innerHTML = "<h1>Error loading project</h1><p>Please try again.</p>";
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
