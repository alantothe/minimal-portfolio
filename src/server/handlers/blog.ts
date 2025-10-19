export async function blogHandler(): Promise<Response> {
  try {
    const template = Bun.file('./src/pages/blog/page.html');
    
    if (!(await template.exists())) {
      throw new Error('Blog page template not found');
    }
    
    const html = await template.text();
    
    return new Response(html, {
      headers: {
        "Content-Type": "text/html",
      },
    });
  } catch (error) {
    console.error('Error loading blog page:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
