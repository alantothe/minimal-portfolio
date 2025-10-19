export async function aboutHandler(): Promise<Response> {
  try {
    const template = Bun.file('./src/pages/about/page.html');
    
    if (!(await template.exists())) {
      throw new Error('About page template not found');
    }
    
    const html = await template.text();
    
    return new Response(html, {
      headers: {
        "Content-Type": "text/html",
      },
    });
  } catch (error) {
    console.error('Error loading about page:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
