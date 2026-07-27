interface ViewCooldownOptions {
  now?: () => number;
  cooldownMs?: number;
  maxEntries?: number;
  maxViewsPerWindow?: number;
  windowMs?: number;
}

export class ViewCooldown {
  private readonly timestamps = new Map<string, number>();
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private readonly maxEntries: number;
  private readonly maxViewsPerWindow: number;
  private readonly windowMs: number;
  private readonly postWindows = new Map<string, number[]>();

  constructor(options: ViewCooldownOptions = {}) {
    this.now = options.now || Date.now;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.maxEntries = options.maxEntries ?? 10_000;
    this.maxViewsPerWindow = options.maxViewsPerWindow ?? 60;
    this.windowMs = options.windowMs ?? 60 * 60 * 1000;
  }

  shouldCount(slug: string, visitorId: string): boolean {
    const timestamp = this.now();
    const key = `${slug}:${visitorId}`;
    const previousTimestamp = this.timestamps.get(key);

    if (
      previousTimestamp !== undefined
      && timestamp - previousTimestamp < this.cooldownMs
    ) {
      return false;
    }

    const windowStart = timestamp - this.windowMs;
    const recentViews = (this.postWindows.get(slug) || [])
      .filter(viewTimestamp => viewTimestamp > windowStart);
    if (recentViews.length >= this.maxViewsPerWindow) {
      this.postWindows.set(slug, recentViews);
      return false;
    }

    if (!this.timestamps.has(key) && this.timestamps.size >= this.maxEntries) {
      const oldestKey = this.timestamps.keys().next().value;
      if (oldestKey !== undefined) {
        this.timestamps.delete(oldestKey);
      }
    }

    this.timestamps.set(key, timestamp);
    recentViews.push(timestamp);
    this.postWindows.set(slug, recentViews);
    return true;
  }
}

const viewCooldown = new ViewCooldown();

export function shouldCountView(slug: string, visitorId: string): boolean {
  return viewCooldown.shouldCount(slug, visitorId);
}
