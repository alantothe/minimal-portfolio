import type { BlogPostSummary } from '../handlers/blog';
import type { ProjectSummary } from '../handlers/projects';

export const BLOG_PAGE_SIZE = 4;
export const PROJECT_PAGE_SIZE = 6;

export class CollectionPageNotFoundError extends Error {
  constructor() {
    super('Collection page not found');
    this.name = 'CollectionPageNotFoundError';
  }
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getPageItems<T>(items: T[], page: number, pageSize: number): T[] {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  if (!Number.isInteger(page) || page < 1 || page > totalPages) {
    throw new CollectionPageNotFoundError();
  }

  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

function renderPagination(
  basePath: '/blog' | '/projects',
  page: number,
  itemCount: number,
  pageSize: number,
): string {
  const totalPages = Math.ceil(itemCount / pageSize);
  if (totalPages <= 1) {
    return '';
  }

  const links = Array.from({ length: totalPages }, (_, index) => {
    const pageNumber = index + 1;
    const href = pageNumber === 1 ? basePath : `${basePath}?page=${pageNumber}`;
    const current = pageNumber === page
      ? ' active" aria-current="page'
      : '';
    return `<a class="pagination-btn${current}" href="${href}">${pageNumber}</a>`;
  }).join('');

  return `<nav class="pagination-controls" aria-label="Pagination"><div class="pagination-numbers">${links}</div></nav>`;
}

export function renderBlogCollection(posts: BlogPostSummary[], page: number) {
  const pageSize = BLOG_PAGE_SIZE;
  const pageItems = getPageItems(posts, page, pageSize);
  const itemsHtml = pageItems.length === 0
    ? '<p class="no-posts">No blog posts yet. Check back soon!</p>'
    : pageItems.map(post => `
      <article class="blog-post-preview">
        <h2 class="post-title">
          <a href="/blog/${encodeURIComponent(post.slug)}" class="post-link" data-slug="${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a>
        </h2>
        <p class="post-views">${post.views} views</p>
      </article>
    `).join('');

  return {
    itemsHtml,
    paginationHtml: renderPagination('/blog', page, posts.length, pageSize),
  };
}

export function renderProjectCollection(projects: ProjectSummary[], page: number) {
  const pageSize = PROJECT_PAGE_SIZE;
  const pageItems = getPageItems(projects, page, pageSize);
  const itemsHtml = pageItems.length === 0
    ? '<p class="no-projects">No projects yet. Check back soon!</p>'
    : pageItems.map(project => {
      const year = project.year
        ?? (project.date ? new Date(project.date).getFullYear() : '');
      const accent = typeof project.accent === 'string'
        && /^#[0-9a-f]{6}$/i.test(project.accent)
        ? project.accent
        : '#8aa0b2';
      const stack = Array.isArray(project.stack)
        ? project.stack.slice(0, 4)
        : [];

      return `
        <article class="project-card" style="--project-accent: ${accent}">
          <a href="/projects/${encodeURIComponent(project.slug)}" class="project-link" data-project-id="${escapeHtml(project.slug)}" aria-label="Read ${escapeHtml(project.title)} case study">
            <div class="project-card__topline">
              <span class="project-card__type">${escapeHtml(project.kicker || 'Project')}</span>
              <span class="project-card__year">${year}</span>
            </div>
            <h2 class="project-title">${escapeHtml(project.title)}</h2>
            ${project.description ? `<p class="project-summary">${escapeHtml(project.description)}</p>` : ''}
            ${stack.length > 0 ? `
              <ul class="project-card__stack" aria-label="Technology stack">
                ${stack.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
              </ul>
            ` : ''}
            <span class="project-card__arrow" aria-hidden="true">↗</span>
          </a>
        </article>
      `;
    }).join('');

  return {
    itemsHtml,
    paginationHtml: renderPagination('/projects', page, projects.length, pageSize),
  };
}
