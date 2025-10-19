import { LayoutRenderer } from '../core/layoutRenderer.ts';

const renderer = new LayoutRenderer();

export async function projectsHandler(): Promise<Response> {
  try {
    const content = await renderer.loadPageContent('projects');
    const html = await renderer.render({
      title: 'Projects - Portfolio',
      content,
      activePage: 'projects',
    });

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html',
      },
    });
  } catch (error) {
    console.error('Error rendering projects page:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
