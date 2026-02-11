import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadPageContent } from '../src/server/handlers/api';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const pageName = req.query.name as string;
    const validPages = ['home', 'about', 'projects', 'blog'];

    if (!pageName || !validPages.includes(pageName)) {
      return res.status(400).json({ error: 'Invalid or missing page name' });
    }

    const pageData = await loadPageContent(pageName);
    res.status(200).json(pageData);
  } catch (error: any) {
    console.error('Error in /api/page:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
