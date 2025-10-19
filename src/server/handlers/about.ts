import { LayoutRenderer } from '../core/layoutRenderer.ts';

const renderer = new LayoutRenderer();

export async function aboutHandler(): Promise<Response> {
  try {
    const content = await renderer.loadPageContent('about');
    const html = await renderer.render({
      title: 'About - Portfolio',
      content,
      activePage: 'about',
    });

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html',
      },
    });
  } catch (error) {
    console.error('Error rendering about page:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
