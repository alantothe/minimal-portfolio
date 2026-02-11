import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createBlogPostHandler } from '../../src/server/handlers/blog';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const slug = req.query.slug as string;
  const url = new URL(req.url!, `https://${req.headers.host}`);
  const blogHandler = createBlogPostHandler(url, { slug });
  const response = await blogHandler();
  const body = await response.json();
  res.status(response.status).json(body);
}
