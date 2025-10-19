import { LayoutRenderer } from '../core/layoutRenderer.ts';

const renderer = new LayoutRenderer();

export async function homeHandler(): Promise<Response> {
  try {
    const content = await renderer.loadPageContent('home');
    const html = await renderer.render({
      title: 'Home - Portfolio',
      content,
      activePage: 'home',
    });

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html',
      },
    });
  } catch (error) {
    console.error('Error rendering home page:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
