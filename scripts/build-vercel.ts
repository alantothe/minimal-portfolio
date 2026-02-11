/**
 * Build script for Vercel deployment
 * Copies static assets into dist/ matching the URL structure the SPA expects
 */

import { mkdirSync, cpSync, existsSync } from 'fs';
import { join } from 'path';

const DIST = './dist';

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function copy(src: string, dest: string) {
  if (!existsSync(src)) {
    console.warn(`Warning: ${src} does not exist, skipping`);
    return;
  }
  cpSync(src, dest, { recursive: true });
}

// Clean and create dist
if (existsSync(DIST)) {
  cpSync(DIST, DIST, { recursive: true }); // no-op to ensure it exists
}
mkdirSync(DIST, { recursive: true });

// Copy shell.html (SPA entry point)
copy('./src/pages/shell.html', join(DIST, 'shell.html'));

// Copy public assets
ensureDir(join(DIST, 'public', 'css'));
copy('./src/public/css/global.css', join(DIST, 'public', 'css', 'global.css'));
copy('./src/public/spa-router.js', join(DIST, 'public', 'spa-router.js'));
copy('./src/public/image-loader.js', join(DIST, 'public', 'image-loader.js'));
copy('./src/public/logo.png', join(DIST, 'public', 'logo.png'));
copy('./src/public/avatar.png', join(DIST, 'public', 'avatar.png'));

// Copy page-specific CSS and JS
const pages = ['home', 'about', 'projects', 'blog'];
for (const page of pages) {
  ensureDir(join(DIST, 'pages', page));
  copy(
    `./src/pages/${page}/styles.css`,
    join(DIST, 'pages', page, 'styles.css')
  );
}

// Copy pagination.js for blog and projects
copy('./src/pages/blog/pagination.js', join(DIST, 'pages', 'blog', 'pagination.js'));
copy('./src/pages/projects/pagination.js', join(DIST, 'pages', 'projects', 'pagination.js'));

console.log('Build complete: dist/ ready for Vercel');
