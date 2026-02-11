import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadPageContent } from '../src/server/handlers/api';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const pageNames = ['home', 'about', 'projects', 'blog'];
    const allPages: Record<string, any> = {};

    await Promise.all(
      pageNames.map(async (pageName) => {
        allPages[pageName] = await loadPageContent(pageName);
      })
    );

    res.status(200).json({ pages: allPages });
  } catch (error: any) {
    console.error('Error in /api/pages:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
