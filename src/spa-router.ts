/**
 * Progressive Enhancement Router
 * Adds smooth client-side navigation on top of SSR
 * Falls back to standard navigation if JS is disabled
 */

/// <reference lib="dom" />


class ProgressiveRouter {
  private mainContent: HTMLElement | null;
  private navLinks: NodeListOf<HTMLAnchorElement>;
  private isNavigating = false;

  constructor() {
    this.mainContent = document.getElementById('main-content');
    this.navLinks = document.querySelectorAll('.nav-link');

    if (!this.mainContent) {
      console.warn('Main content element not found. Client-side navigation disabled.');
      return;
    }

    this.init();
  }

  private init(): void {
    // Intercept navigation clicks for smooth transitions
    this.navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        // Don't intercept if already active
        if (link.classList.contains('active')) {
          e.preventDefault();
          return;
        }

        // Don't intercept if Ctrl/Cmd/Shift click (user wants new tab)
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          return;
        }

        e.preventDefault();
        const href = link.getAttribute('href');
        if (href) {
          this.navigateTo(href);
        }
      });
    });

    // Handle browser back/forward
    window.addEventListener('popstate', () => {
      this.loadPage(window.location.pathname, false);
    });
  }

  private navigateTo(url: string): void {
    if (this.isNavigating) return;
    this.loadPage(url, true);
  }

  private async loadPage(url: string, updateHistory: boolean): Promise<void> {
    if (this.isNavigating || !this.mainContent) return;

    this.isNavigating = true;

    try {
      // Fetch the full page
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Extract the new content
      const newContent = doc.getElementById('main-content');
      const newTitle = doc.querySelector('title')?.textContent;

      if (!newContent) {
        throw new Error('Content not found in response');
      }

      // Update history
      if (updateHistory) {
        history.pushState({}, '', url);
      }

      // Update title
      if (newTitle) {
        document.title = newTitle;
      }

      // Smooth transition
      this.mainContent.style.opacity = '0';
      this.mainContent.style.transform = 'translateY(10px)';

      setTimeout(() => {
        if (this.mainContent) {
          this.mainContent.innerHTML = newContent.innerHTML;
          this.mainContent.style.opacity = '1';
          this.mainContent.style.transform = 'translateY(0)';
        }

        // Update active nav state
        this.updateActiveNav(url);
        this.isNavigating = false;
      }, 150);
    } catch (error) {
      console.error('Navigation failed, falling back to full page load:', error);
      // Fall back to full page navigation
      window.location.href = url;
    }
  }

  private updateActiveNav(url: string): void {
    const pathname = new URL(url, window.location.origin).pathname;

    this.navLinks.forEach(link => {
      const linkPath = link.getAttribute('href');
      const isActive =
        linkPath === pathname ||
        (pathname === '/' && linkPath === '/') ||
        (pathname === '/home' && linkPath === '/');

      if (isActive) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new ProgressiveRouter());
} else {
  new ProgressiveRouter();
}
