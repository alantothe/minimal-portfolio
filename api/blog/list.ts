import type { VercelRequest, VercelResponse } from '@vercel/node';
import { blogListHandler } from '../../src/server/handlers/blog';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const response = await blogListHandler();
  const body = await response.json();
  res.status(response.status).json(body);
}
