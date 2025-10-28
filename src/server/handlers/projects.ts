/**
 * Projects API handlers for listing projects and fetching individual projects
 */

import { readMarkdownFile, generateSlug } from '../services/markdown.ts';
import type { BlogPostMetadata } from '../services/markdown.ts';
import { readdirSync } from 'fs';
import { join } from 'path';

const PROJECTS_CONTENT_DIR = './src/content/projects';

export interface ProjectSummary {
  slug: string;
  title: string;
  description?: string;
  image?: string;
  date?: string;
}

/**
 * Get all projects with metadata
 */
async function getAllProjects(): Promise<ProjectSummary[]> {
  try {
    const dirs = readdirSync(PROJECTS_CONTENT_DIR, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    const projects = await Promise.all(
      dirs.map(async (dir) => {
        try {
          const filePath = join(PROJECTS_CONTENT_DIR, dir, 'content.md');
          const project = await readMarkdownFile(filePath);

          return {
            slug: dir,
            title: project.metadata.title,
            description: project.metadata.description,
            image: project.metadata.image,
            date: project.metadata.date
          };
        } catch (error) {
          console.error(`Error reading project ${dir}:`, error);
          return null;
        }
      })
    );

    // Filter out null entries and sort by date (newest first) if available
    return projects
      .filter((p): p is ProjectSummary => p !== null)
      .sort((a, b) => {
        if (a.date && b.date) {
          const dateA = new Date(a.date).getTime();
          const dateB = new Date(b.date).getTime();
          return dateB - dateA;
        }
        return 0;
      });
  } catch (error) {
    console.error('Error reading projects:', error);
    return [];
  }
}

/**
 * Get a single project by slug
 */
async function getProjectBySlug(slug: string) {
  try {
    const filePath = join(PROJECTS_CONTENT_DIR, slug, 'content.md');
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

      // Wrap HTML content with markdown-content class for styling
      const wrappedHtml = `<div class="markdown-content">${project.html}</div>`;

      return new Response(
        JSON.stringify({ ...project, html: wrappedHtml }),
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
