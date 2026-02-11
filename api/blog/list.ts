import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAllBlogPosts } from '../../src/server/handlers/blog';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const posts = await getAllBlogPosts();
    res.status(200).json({ posts });
  } catch (error: any) {
    console.error('Error in /api/blog/list:', error);
    res.status(500).json({ error: error.message || 'Failed to load blog posts' });
  }
}
