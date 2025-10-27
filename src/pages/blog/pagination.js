/**
 * Blog Pagination System
 * Handles client-side pagination for blog posts list with smart page number display
 */

window.BlogPagination = class BlogPagination {
  constructor(articlesPerPage = 4) {
    this.articlesPerPage = articlesPerPage;
    this.allArticles = [];
    this.currentPage = 1;
  }

  /**
   * Initialize pagination with articles and optional page from URL
   */
  init(articles) {
    this.allArticles = articles;
    this.currentPage = this.getPageFromURL() || 1;
    this.render();
  }

  /**
   * Get current page from URL query parameter
   */
  getPageFromURL() {
    const params = new URLSearchParams(window.location.search);
    const page = parseInt(params.get('page'), 10);
    return page && page > 0 ? page : 1;
  }

  /**
   * Update URL with current page (without full reload)
   */
  updateURL(page) {
    const url = new URL(window.location);
    url.searchParams.set('page', page);
    window.history.replaceState({ page }, '', url.toString());
  }

  /**
   * Calculate total pages
   */
  getTotalPages() {
    return Math.ceil(this.allArticles.length / this.articlesPerPage);
  }

  /**
   * Get articles for current page
   */
  getPageArticles() {
    const start = (this.currentPage - 1) * this.articlesPerPage;
    const end = start + this.articlesPerPage;
    return this.allArticles.slice(start, end);
  }

  calculateVisiblePageNumbers() {
    const totalPages = this.getTotalPages();
    const current = this.currentPage;
    const visible = [];

    visible.push(1);

    const rangeStart = Math.max(2, current - 1);
    const rangeEnd = Math.min(totalPages - 1, current + 1);

    if (rangeStart > 2) {
      visible.push('...');
    }

    for (let i = rangeStart; i <= rangeEnd; i++) {
      visible.push(i);
    }

    if (rangeEnd < totalPages - 1) {
      visible.push('...');
    }

    if (totalPages > 1) {
      visible.push(totalPages);
    }

    return visible;
  }

  /**
   * Generate HTML for pagination controls
   */
  renderPaginationHTML() {
    const totalPages = this.getTotalPages();

    // Hide pagination if only 1 page or no articles
    if (totalPages <= 1) {
      return '';
    }

    const visiblePages = this.calculateVisiblePageNumbers();
    const pageButtons = visiblePages
      .map(page => {
        if (page === '...') {
          return '<span class="pagination-ellipsis">...</span>';
        }

        const isActive = page === this.currentPage;
        const activeClass = isActive ? ' active' : '';
        return `<button class="pagination-btn${activeClass}" data-page="${page}">${page}</button>`;
      })
      .join('');

    return `
      <nav class="pagination-controls">
        <div class="pagination-numbers">
          ${pageButtons}
        </div>
      </nav>
    `;
  }

  /**
   * Main render function - updates articles display and pagination controls
   */
  render() {
    this.renderArticles();
    this.renderPagination();
    this.attachEventListeners();
  }

  /**
   * Render the articles for current page
   */
  renderArticles() {
    const container = document.getElementById('blog-posts');
    if (!container) return;

    const articles = this.getPageArticles();

    if (articles.length === 0) {
      container.innerHTML = '<p class="no-posts">No blog posts yet. Check back soon!</p>';
      return;
    }

    container.innerHTML = articles
      .map(
        post => `
      <article class="blog-post-preview">
        <h3 class="post-title">
          <a href="/blog/${post.slug}" class="post-link" data-slug="${post.slug}">
            ${post.title}
          </a>
        </h3>
        <p class="post-views" data-post-id="${post.slug}">${post.views || 0} views</p>
      </article>
    `
      )
      .join('');

    // Attach click handlers for SPA navigation
    container.querySelectorAll('.post-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const slug = e.currentTarget.dataset.slug;
        window.history.pushState({ page: 'blog-post', slug }, '', `/blog/${slug}`);
        window.dispatchEvent(new CustomEvent('navigate-to-post', { detail: { slug } }));
      });
    });
  }

  /**
   * Render pagination controls
   */
  renderPagination() {
    const container = document.getElementById('blog-pagination');
    if (!container) return;

    container.innerHTML = this.renderPaginationHTML();
  }

  attachEventListeners() {
    const container = document.getElementById('blog-pagination');
    if (!container) return;

    const buttons = container.querySelectorAll('.pagination-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', e => {
        const page = parseInt(e.currentTarget.dataset.page, 10);
        this.goToPage(page);
      });
    });
  }

  /**
   * Navigate to specific page
   */
  goToPage(page) {
    const totalPages = this.getTotalPages();
    if (page < 1 || page > totalPages || page === this.currentPage) {
      return;
    }

    this.currentPage = page;
    this.updateURL(page);
    this.render();
  }
};
