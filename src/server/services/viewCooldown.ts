interface ViewCooldownOptions {
  now?: () => number;
  cooldownMs?: number;
  maxEntries?: number;
}

export class ViewCooldown {
  private readonly timestamps = new Map<string, number>();
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private readonly maxEntries: number;

  constructor(options: ViewCooldownOptions = {}) {
    this.now = options.now || Date.now;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.maxEntries = options.maxEntries ?? 10_000;
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

    if (!this.timestamps.has(key) && this.timestamps.size >= this.maxEntries) {
      const oldestKey = this.timestamps.keys().next().value;
      if (oldestKey !== undefined) {
        this.timestamps.delete(oldestKey);
      }
    }

    this.timestamps.set(key, timestamp);
    return true;
  }
}

const viewCooldown = new ViewCooldown();

export function shouldCountView(slug: string, visitorId: string): boolean {
  return viewCooldown.shouldCount(slug, visitorId);
}
