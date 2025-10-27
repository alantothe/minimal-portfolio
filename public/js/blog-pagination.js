/**
 * Blog Pagination System
 * Handles client-side pagination for blog posts list with smart page number display
 */

class BlogPagination {
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

  /**
   * Smart pagination logic: returns array of page numbers to display
   * Logic: Always show 1, current ±1, and last page, with ellipsis for gaps
   * Example: 1 ... 7 8 9 10 11 ... 20
   */
  calculateVisiblePageNumbers() {
    const totalPages = this.getTotalPages();
    const current = this.currentPage;
    const visible = [];

    // Always add first page
    visible.push(1);

    // Determine range around current page (current ±1)
    const rangeStart = Math.max(2, current - 1);
    const rangeEnd = Math.min(totalPages - 1, current + 1);

    // Add ellipsis before range if there's a gap
    if (rangeStart > 2) {
      visible.push('...');
    }

    // Add the range
    for (let i = rangeStart; i <= rangeEnd; i++) {
      visible.push(i);
    }

    // Add ellipsis after range if there's a gap
    if (rangeEnd < totalPages - 1) {
      visible.push('...');
    }

    // Always add last page if there are multiple pages
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
        <button class="pagination-btn pagination-prev" data-page="prev" ${this.currentPage === 1 ? 'disabled' : ''}>
          ← Previous
        </button>
        <div class="pagination-numbers">
          ${pageButtons}
        </div>
        <button class="pagination-btn pagination-next" data-page="next" ${this.currentPage === totalPages ? 'disabled' : ''}>
          Next →
        </button>
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
        <p class="post-date">${new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        <p class="post-excerpt">${post.excerpt || 'No excerpt available'}</p>
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

  /**
   * Attach event listeners to pagination buttons
   */
  attachEventListeners() {
    const container = document.getElementById('blog-pagination');
    if (!container) return;

    const buttons = container.querySelectorAll('.pagination-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', e => {
        const page = e.currentTarget.dataset.page;

        if (page === 'prev') {
          if (this.currentPage > 1) {
            this.goToPage(this.currentPage - 1);
          }
        } else if (page === 'next') {
          if (this.currentPage < this.getTotalPages()) {
            this.goToPage(this.currentPage + 1);
          }
        } else {
          this.goToPage(parseInt(page, 10));
        }
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

    // Scroll to top of blog posts
    const blogPostsElement = document.getElementById('blog-posts');
    if (blogPostsElement) {
      blogPostsElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BlogPagination;
}
