import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getProjectBySlug } from '../../src/server/handlers/projects';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const slug = req.query.slug as string;
    if (!slug) {
      return res.status(400).json({ error: 'Slug parameter is required' });
    }

    const project = await getProjectBySlug(slug);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const wrappedHtml = `<div class="markdown-content">${project.html}</div>`;
    res.status(200).json({ ...project, html: wrappedHtml });
  } catch (error: any) {
    console.error('Error in /api/projects/[slug]:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
