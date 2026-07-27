/**
 * Blog view tracking service backed by a single JSON file.
 */

import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { readdirSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_VIEWS_FILE = "./src/data/blog-views.json";
const BLOG_CONTENT_DIR = "./src/content/blog";

interface ViewCounts {
  [slug: string]: number;
}

export class JsonViewStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath =
      process.env.BLOG_VIEWS_FILE || DEFAULT_VIEWS_FILE,
  ) {}

  async getAll(): Promise<ViewCounts> {
    try {
      const content = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(content);

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("View data must be a JSON object");
      }

      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === "number" &&
            Number.isFinite(entry[1]) &&
            entry[1] >= 0,
        ),
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return {};
      }

      throw error;
    }
  }

  async get(slug: string): Promise<number> {
    const views = await this.getAll();
    return views[slug] || 0;
  }

  async increment(slug: string): Promise<number> {
    return this.enqueueMutation(async () => {
      const views = await this.getAll();
      views[slug] = (views[slug] || 0) + 1;
      await this.writeAtomically(views);
      return views[slug];
    });
  }

  async total(): Promise<number> {
    const views = await this.getAll();
    return Object.values(views).reduce((sum, count) => sum + count, 0);
  }

  async retain(existingSlugs: Set<string>): Promise<string[]> {
    return this.enqueueMutation(async () => {
      const views = await this.getAll();
      const orphanedSlugs = Object.keys(views).filter(
        slug => !existingSlugs.has(slug),
      );

      if (orphanedSlugs.length === 0) {
        return [];
      }

      const retainedViews = Object.fromEntries(
        Object.entries(views).filter(([slug]) => existingSlugs.has(slug)),
      );
      await this.writeAtomically(retainedViews);
      return orphanedSlugs;
    });
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async writeAtomically(views: ViewCounts): Promise<void> {
    const directory = dirname(this.filePath);
    const temporaryFile = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;

    await mkdir(directory, { recursive: true });

    try {
      await writeFile(temporaryFile, JSON.stringify(views, null, 2), "utf8");
      await rename(temporaryFile, this.filePath);
    } catch (error) {
      await unlink(temporaryFile).catch(() => undefined);
      throw error;
    }
  }
}

const viewStore = new JsonViewStore();

export async function getViewCounts(): Promise<ViewCounts> {
  try {
    return await viewStore.getAll();
  } catch (error) {
    console.error("Error reading view counts:", error);
    return {};
  }
}

export async function getPostViews(slug: string): Promise<number> {
  try {
    return await viewStore.get(slug);
  } catch (error) {
    console.error("Error reading post views:", error);
    return 0;
  }
}

export async function incrementPostView(slug: string): Promise<number> {
  try {
    return await viewStore.increment(slug);
  } catch (error) {
    console.error("Error incrementing view count:", error);
    return 0;
  }
}

export async function getTotalViews(): Promise<number> {
  try {
    return await viewStore.total();
  } catch (error) {
    console.error("Error calculating total views:", error);
    return 0;
  }
}

export async function syncViewsWithBlogPosts(): Promise<void> {
  try {
    const files = readdirSync(BLOG_CONTENT_DIR).filter(file =>
      file.endsWith(".md"),
    );
    const existingSlugs = new Set(
      files.map(file =>
        file
          .replace(/\.md$/, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
      ),
    );
    const orphanedSlugs = await viewStore.retain(existingSlugs);

    if (orphanedSlugs.length > 0) {
      console.log(
        `[View Sync] Cleaned up orphaned view entries: ${orphanedSlugs.join(", ")}`,
      );
    }
  } catch (error) {
    console.error("[View Sync] Error syncing views with blog posts:", error);
  }
}
