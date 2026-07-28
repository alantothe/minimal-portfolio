/**
 * Projects API handlers for listing projects and fetching individual projects
 */

import { readMarkdownFile, generateSlug } from '../services/markdown';
import { fileExists } from '../core/file';
import { createSeoMetadata } from '../services/seo';
import { readdirSync } from 'fs';
import { join } from 'path';

const PROJECTS_CONTENT_DIR = './src/content/projects';

export interface ProjectSummary {
  slug: string;
  title: string;
  description?: string;
  image?: string;
  date?: string;
  kicker?: string;
  stack?: string[];
  accent?: string;
  order?: number;
  year?: string | number;
}

export interface ProjectDetail {
  slug: string;
  metadata: Record<string, any>;
  html: string;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeAccent(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : '#8aa0b2';
}

function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function renderProjectLink(url: string, label: string): string {
  return `<a class="project-action" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}<span aria-hidden="true">↗</span></a>`;
}

export function renderProjectArticle(project: ProjectDetail): string {
  const { metadata } = project;
  const accent = safeAccent(metadata.accent);
  const stack = Array.isArray(metadata.stack)
    ? metadata.stack.filter((item): item is string => typeof item === 'string')
    : [];
  const repository = safeExternalUrl(metadata.repository);
  const live = safeExternalUrl(metadata.live);
  const actions = [
    live ? renderProjectLink(live, 'Visit project') : '',
    repository ? renderProjectLink(repository, 'View repository') : '',
  ].filter(Boolean).join('');

  const facts = [
    ['Role', metadata.role],
    ['Status', metadata.status],
    ['Year', metadata.year],
  ].filter((fact): fact is [string, string | number] => (
    typeof fact[1] === 'string' || typeof fact[1] === 'number'
  ));

  return `
    <article class="project-case-study" style="--project-accent: ${accent}">
      <header class="project-hero">
        <p class="project-kicker">${escapeHtml(metadata.kicker || 'Selected project')}</p>
        <h1>${escapeHtml(metadata.title)}</h1>
        <p class="project-dek">${escapeHtml(metadata.description || '')}</p>
        <div class="project-facts">
          ${facts.map(([label, value]) => `
            <div class="project-fact">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </div>
          `).join('')}
        </div>
        ${stack.length > 0 ? `
          <ul class="project-stack" aria-label="Technology stack">
            ${stack.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        ` : ''}
        ${actions ? `<div class="project-actions">${actions}</div>` : ''}
      </header>
      <div class="project-case-study__body markdown-content">
        ${project.html}
      </div>
    </article>
  `.trim();
}

/**
 * Get all projects with metadata
 */
export async function getAllProjects(): Promise<ProjectSummary[]> {
  try {
    const dirs = readdirSync(PROJECTS_CONTENT_DIR, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    const projects = await Promise.all(
      dirs.map(async (dir): Promise<ProjectSummary | null> => {
        try {
          const filePath = join(PROJECTS_CONTENT_DIR, dir, 'content.md');
          const project = await readMarkdownFile(filePath);

          return {
            slug: dir,
            title: project.metadata.title,
            description: project.metadata.description,
            image: project.metadata.image,
            date: project.metadata.date,
            kicker: project.metadata.kicker,
            stack: Array.isArray(project.metadata.stack)
              ? project.metadata.stack
              : [],
            accent: project.metadata.accent,
            order: typeof project.metadata.order === 'number'
              ? project.metadata.order
              : undefined,
            year: typeof project.metadata.year === 'string'
              || typeof project.metadata.year === 'number'
              ? project.metadata.year
              : undefined,
          };
        } catch (error) {
          console.error(`Error reading project ${dir}:`, error);
          return null;
        }
      })
    );

    // Explicit portfolio order wins. Date remains the fallback for older content.
    const valid = projects.filter((p): p is ProjectSummary => p !== null);
    valid.sort((a, b) => {
      if (a.order !== undefined || b.order !== undefined) {
        return (a.order ?? Number.MAX_SAFE_INTEGER)
          - (b.order ?? Number.MAX_SAFE_INTEGER);
      }
      if (a.date && b.date) {
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      }
      return 0;
    });
    return valid;
  } catch (error) {
    console.error('Error reading projects:', error);
    return [];
  }
}

/**
 * Get a single project by slug
 */
export async function getProjectBySlug(slug: string): Promise<ProjectDetail | null> {
  try {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return null;
    }

    const filePath = join(PROJECTS_CONTENT_DIR, slug, 'content.md');
    if (!(await fileExists(filePath))) {
      return null;
    }

    const project = await readMarkdownFile(filePath);

    return {
      slug,
      metadata: project.metadata,
      html: project.html
    };
  } catch (error) {
    console.error('Error reading project:', error);
    return null;
  }
}

/**
 * Handler for /api/projects/list - returns list of all projects
 */
export async function projectsListHandler(): Promise<Response> {
  try {
    const projects = await getAllProjects();

    return new Response(
      JSON.stringify({ projects }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
      }
    );
  } catch (error) {
    console.error('Error in projects list handler:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to load projects' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Handler for /api/projects/:slug - returns single project
 */
export function createProjectHandler(url: URL, params?: Record<string, string>) {
  return async (): Promise<Response> => {
    try {
      const slug = params?.slug;

      if (!slug) {
        return new Response(
          JSON.stringify({ error: 'Slug parameter is required' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      const project = await getProjectBySlug(slug);

      if (!project) {
        return new Response(
          JSON.stringify({ error: 'Project not found' }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      const renderedHtml = renderProjectArticle(project);
      const seo = createSeoMetadata({
        kind: 'project',
        slug: project.slug,
        title: project.metadata.title,
        description: project.metadata.description || '',
      }, url);

      return new Response(
        JSON.stringify({ ...project, html: renderedHtml, seo }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
        }
      );
    } catch (error) {
      console.error('Error in project handler:', error);
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  };
}
