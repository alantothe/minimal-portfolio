export async function homeHandler(): Promise<Response> {
  try {
    const template = Bun.file('./src/features/home/page.html');
    
    if (!(await template.exists())) {
      throw new Error('Home page template not found');
    }
    
    const html = await template.text();
    
    return new Response(html, {
      headers: {
        "Content-Type": "text/html",
      },
    });
  } catch (error) {
    console.error('Error loading home page:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
