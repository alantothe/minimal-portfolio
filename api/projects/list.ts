import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAllProjects } from '../../src/server/handlers/projects';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const projects = await getAllProjects();
    res.status(200).json({ projects });
  } catch (error: any) {
    console.error('Error in /api/projects/list:', error);
    res.status(500).json({ error: error.message || 'Failed to load projects' });
  }
}
