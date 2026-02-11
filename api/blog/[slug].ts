import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBlogPostBySlug } from '../../src/server/handlers/blog';
import { getPostViews, incrementPostView } from '../../src/server/services/views';
import { shouldCountView } from '../../src/server/services/viewCooldown';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const slug = req.query.slug as string;
    if (!slug) {
      return res.status(400).json({ error: 'Slug parameter is required' });
    }

    const post = await getBlogPostBySlug(slug);
    if (!post) {
      return res.status(404).json({ error: 'Blog post not found' });
    }

    const clientIp = (req.headers['x-forwarded-for'] as string) || 'unknown';
    let views = await getPostViews(slug);

    if (shouldCountView(slug, clientIp)) {
      views = await incrementPostView(slug);
    }

    const wrappedHtml = `<div class="markdown-content">${post.html}</div>`;
    res.status(200).json({ ...post, html: wrappedHtml, views });
  } catch (error: any) {
    console.error('Error in /api/blog/[slug]:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
