interface GitHubCommitSearchResponse {
  total_count: number;
}

interface CacheEntry {
  count: number;
  expiresAt: number;
}

type FetchFunction = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface GitHubCommitCounterOptions {
  fetch?: FetchFunction;
  now?: () => Date;
  ttlMs?: number;
  timeoutMs?: number;
}

export class GitHubCommitCounter {
  private readonly fetchImpl: FetchFunction;
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<number>>();

  constructor(options: GitHubCommitCounterOptions = {}) {
    this.fetchImpl = options.fetch || fetch;
    this.now = options.now || (() => new Date());
    this.ttlMs = options.ttlMs ?? 15 * 60 * 1000;
    this.timeoutMs = options.timeoutMs ?? 3_000;
  }

  async getMonthlyCommitCount(
    token?: string,
    username?: string,
  ): Promise<number> {
    if (!token || !username) {
      return 0;
    }

    const now = this.now();
    const monthId = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const cacheKey = `${username}:${monthId}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > now.getTime()) {
      return cached.count;
    }

    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      return pending;
    }

    const request = this.fetchCount(token, username, now)
      .then(count => {
        this.cache.set(cacheKey, {
          count,
          expiresAt: this.now().getTime() + this.ttlMs,
        });
        return count;
      })
      .catch(() => cached?.count ?? 0)
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });

    this.inFlight.set(cacheKey, request);
    return request;
  }

  private async fetchCount(
    token: string,
    username: string,
    now: Date,
  ): Promise<number> {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 0));
    const formatDate = (date: Date) => date.toISOString().slice(0, 10);
    const query = `author:${username} author-date:${formatDate(start)}..${formatDate(end)}`;
    const url = `https://api.github.com/search/commits?q=${encodeURIComponent(query)}&per_page=1`;
    const response = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json() as GitHubCommitSearchResponse;
    return data.total_count;
  }
}

const commitCounter = new GitHubCommitCounter();

export async function getMonthlyCommitCount(): Promise<number> {
  return commitCounter.getMonthlyCommitCount(
    process.env.GITHUB_TOKEN,
    process.env.GITHUB_USERNAME,
  );
}
