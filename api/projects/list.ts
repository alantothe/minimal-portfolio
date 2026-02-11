import type { VercelRequest, VercelResponse } from '@vercel/node';
import { projectsListHandler } from '../../src/server/handlers/projects';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const response = await projectsListHandler();
  const body = await response.json();
  res.status(response.status).json(body);
}
