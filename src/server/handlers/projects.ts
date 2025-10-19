export async function projectsHandler(): Promise<Response> {
  try {
    const template = Bun.file('./src/pages/projects/page.html');
    
    if (!(await template.exists())) {
      throw new Error('Projects page template not found');
    }
    
    const html = await template.text();
    
    return new Response(html, {
      headers: {
        "Content-Type": "text/html",
      },
    });
  } catch (error) {
    console.error('Error loading projects page:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
