import { LayoutRenderer } from '../core/layoutRenderer.ts';

const renderer = new LayoutRenderer();

export async function blogHandler(): Promise<Response> {
  try {
    const content = await renderer.loadPageContent('blog');
    const html = await renderer.render({
      title: 'Blog - Portfolio',
      content,
      activePage: 'blog',
    });

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html',
      },
    });
  } catch (error) {
    console.error('Error rendering blog page:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
