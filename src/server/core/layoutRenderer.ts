/**
 * Layout Renderer for SSR
 * Merges page content into the base layout template
 */

export interface PageData {
  title: string;
  content: string;
  activePage: 'home' | 'about' | 'projects' | 'blog';
}

export class LayoutRenderer {
  private baseLayoutCache: string | null = null;

  /**
   * Loads and caches the base layout template
   */
  private async loadBaseLayout(): Promise<string> {
    if (this.baseLayoutCache) {
      return this.baseLayoutCache;
    }

    const layoutFile = Bun.file('./src/layout/base.html');
    if (!(await layoutFile.exists())) {
      throw new Error('Base layout template not found at src/layout/base.html');
    }

    this.baseLayoutCache = await layoutFile.text();
    return this.baseLayoutCache;
  }

  /**
   * Renders a complete HTML page by merging page content with the base layout
   */
  async render(pageData: PageData): Promise<string> {
    const layout = await this.loadBaseLayout();

    // Replace placeholders with actual content
    let html = layout
      .replace('{{TITLE}}', pageData.title)
      .replace('{{CONTENT}}', pageData.content);

    // Set active nav link
    html = html
      .replace('{{ACTIVE_HOME}}', pageData.activePage === 'home' ? 'active' : '')
      .replace('{{ACTIVE_ABOUT}}', pageData.activePage === 'about' ? 'active' : '')
      .replace('{{ACTIVE_PROJECTS}}', pageData.activePage === 'projects' ? 'active' : '')
      .replace('{{ACTIVE_BLOG}}', pageData.activePage === 'blog' ? 'active' : '');

    return html;
  }

  /**
   * Loads page content from a page fragment file
   */
  async loadPageContent(pageName: string): Promise<string> {
    const pageFile = Bun.file(`./src/pages/${pageName}/page.html`);

    if (!(await pageFile.exists())) {
      throw new Error(`Page content not found: ${pageName}`);
    }

    return await pageFile.text();
  }

  /**
   * Clears the layout cache (useful for development)
   */
  clearCache(): void {
    this.baseLayoutCache = null;
  }
}
