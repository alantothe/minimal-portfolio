import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createProjectHandler } from '../../src/server/handlers/projects';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const slug = req.query.slug as string;
  const url = new URL(req.url!, `https://${req.headers.host}`);
  const projectHandler = createProjectHandler(url, { slug });
  const response = await projectHandler();
  const body = await response.json();
  res.status(response.status).json(body);
}
