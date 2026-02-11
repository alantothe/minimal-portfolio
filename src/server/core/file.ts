/**
 * Cross-runtime file utilities
 * Works on both Bun (local dev) and Node.js (Vercel serverless)
 */

import { readFileSync, writeFileSync, accessSync } from 'fs';

const isBun = typeof globalThis.Bun !== 'undefined';

export async function readTextFile(path: string): Promise<string> {
  if (isBun) {
    return Bun.file(path).text();
  }
  return readFileSync(path, 'utf-8');
}

export async function fileExists(path: string): Promise<boolean> {
  if (isBun) {
    return Bun.file(path).exists();
  }
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  if (isBun) {
    await Bun.write(path, content);
    return;
  }
  try {
    writeFileSync(path, content, 'utf-8');
  } catch {
    // Silently fail on read-only filesystems (e.g. Vercel)
  }
}
