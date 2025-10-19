/**
 * shell handler - serves the shell html
 * This is the single HTML file that loads once and handles all navigation client-side
 */

export async function shellHandler(): Promise<Response> {
  try {
    const shellFile = Bun.file('./src/pages/shell.html');

    if (!(await shellFile.exists())) {
      throw new Error('Shell template not found');
    }

    const html = await shellFile.text();

    return new Response(html, {
      headers: {
        "Content-Type": "text/html",
      },
    });
  } catch (error) {
    console.error('Error loading shell:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
