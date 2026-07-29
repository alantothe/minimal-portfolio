interface GitHubCommitSearchResponse {
  total_count: number;
}

interface CacheEntry {
  count: number;
  expiresAt: number;
}

type FetchFunction = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

interface GitHubCommitCounterOptions {
  fetch?: FetchFunction;
  now?: () => Date;
  ttlMs?: number;
  failureTtlMs?: number;
  timeoutMs?: number;
}

export type GitHubContributionLevel =
  | "NONE"
  | "FIRST_QUARTILE"
  | "SECOND_QUARTILE"
  | "THIRD_QUARTILE"
  | "FOURTH_QUARTILE";

export interface GitHubContributionDay {
  count: number;
  date: string;
  level: GitHubContributionLevel;
  weekday: number;
}

export interface GitHubYearlyActivity {
  totalContributions: number;
  totalCommitContributions: number;
  weeks: GitHubContributionDay[][];
}

interface GitHubContributionResponse {
  data?: {
    user?: {
      contributionsCollection?: {
        totalCommitContributions?: number;
        contributionCalendar?: {
          totalContributions?: number;
          weeks?: Array<{
            contributionDays?: Array<{
              contributionCount?: number;
              contributionLevel?: string;
              date?: string;
              weekday?: number;
            }>;
          }>;
        };
      };
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

interface ActivityCacheEntry {
  activity: GitHubYearlyActivity | null;
  expiresAt: number;
}

const contributionLevels = new Set<GitHubContributionLevel>([
  "NONE",
  "FIRST_QUARTILE",
  "SECOND_QUARTILE",
  "THIRD_QUARTILE",
  "FOURTH_QUARTILE",
]);

function normalizeContributionLevel(value: string | undefined) {
  return contributionLevels.has(value as GitHubContributionLevel)
    ? (value as GitHubContributionLevel)
    : "NONE";
}

export class GitHubCommitCounter {
  private readonly fetchImpl: FetchFunction;
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private readonly failureTtlMs: number;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<number>>();

  constructor(options: GitHubCommitCounterOptions = {}) {
    this.fetchImpl = options.fetch || fetch;
    this.now = options.now || (() => new Date());
    this.ttlMs = options.ttlMs ?? 15 * 60 * 1000;
    this.failureTtlMs = options.failureTtlMs ?? 30 * 1000;
    this.timeoutMs = options.timeoutMs ?? 3_000;
  }

  async getMonthlyCommitCount(
    token?: string,
    username?: string
  ): Promise<number> {
    if (!token || !username) {
      return 0;
    }

    const now = this.now();
    const monthId = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
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
      .then((count) => {
        this.cache.set(cacheKey, {
          count,
          expiresAt: this.now().getTime() + this.ttlMs,
        });
        return count;
      })
      .catch(() => {
        const count = cached?.count ?? 0;
        this.cache.set(cacheKey, {
          count,
          expiresAt: this.now().getTime() + this.failureTtlMs,
        });
        return count;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });

    this.inFlight.set(cacheKey, request);
    return request;
  }

  private async fetchCount(
    token: string,
    username: string,
    now: Date
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
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = (await response.json()) as GitHubCommitSearchResponse;
    return data.total_count;
  }
}

export class GitHubContributionCalendar {
  private readonly fetchImpl: FetchFunction;
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private readonly failureTtlMs: number;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, ActivityCacheEntry>();
  private readonly inFlight = new Map<
    string,
    Promise<GitHubYearlyActivity | null>
  >();

  constructor(options: GitHubCommitCounterOptions = {}) {
    this.fetchImpl = options.fetch || fetch;
    this.now = options.now || (() => new Date());
    this.ttlMs = options.ttlMs ?? 15 * 60 * 1000;
    this.failureTtlMs = options.failureTtlMs ?? 30 * 1000;
    this.timeoutMs = options.timeoutMs ?? 3_000;
  }

  async getYearlyActivity(
    token?: string,
    username?: string
  ): Promise<GitHubYearlyActivity | null> {
    if (!token || !username) {
      return null;
    }

    const now = this.now();
    const dayId = now.toISOString().slice(0, 10);
    const cacheKey = `${username}:${dayId}`;
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expiresAt > now.getTime()) {
      return cached.activity;
    }

    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      return pending;
    }

    const request = this.fetchActivity(token, username, now)
      .then((activity) => {
        this.cache.set(cacheKey, {
          activity,
          expiresAt: this.now().getTime() + this.ttlMs,
        });
        return activity;
      })
      .catch(() => {
        const activity = cached?.activity ?? null;
        this.cache.set(cacheKey, {
          activity,
          expiresAt: this.now().getTime() + this.failureTtlMs,
        });
        return activity;
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });

    this.inFlight.set(cacheKey, request);
    return request;
  }

  private async fetchActivity(
    token: string,
    username: string,
    now: Date
  ): Promise<GitHubYearlyActivity> {
    const from = new Date(now);
    from.setUTCFullYear(from.getUTCFullYear() - 1);

    const response = await this.fetchImpl("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        query: `
          query ContributionCalendar(
            $username: String!
            $from: DateTime!
            $to: DateTime!
          ) {
            user(login: $username) {
              contributionsCollection(from: $from, to: $to) {
                totalCommitContributions
                contributionCalendar {
                  totalContributions
                  weeks {
                    contributionDays {
                      contributionCount
                      contributionLevel
                      date
                      weekday
                    }
                  }
                }
              }
            }
          }
        `,
        variables: {
          username,
          from: from.toISOString(),
          to: now.toISOString(),
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const payload = (await response.json()) as GitHubContributionResponse;
    const collection = payload.data?.user?.contributionsCollection;
    const calendar = collection?.contributionCalendar;

    if (!collection || !calendar || payload.errors?.length) {
      throw new Error("GitHub contribution calendar unavailable");
    }

    return {
      totalContributions: calendar.totalContributions ?? 0,
      totalCommitContributions: collection.totalCommitContributions ?? 0,
      weeks: (calendar.weeks ?? []).map((week) =>
        (week.contributionDays ?? []).map((day) => ({
          count: day.contributionCount ?? 0,
          date: day.date ?? "",
          level: normalizeContributionLevel(day.contributionLevel),
          weekday: day.weekday ?? 0,
        }))
      ),
    };
  }
}

const commitCounter = new GitHubCommitCounter();
const contributionCalendar = new GitHubContributionCalendar();

export async function getMonthlyCommitCount(): Promise<number> {
  return commitCounter.getMonthlyCommitCount(
    process.env.GITHUB_TOKEN,
    process.env.GITHUB_USERNAME
  );
}

export async function getYearlyContributionActivity() {
  return contributionCalendar.getYearlyActivity(
    process.env.GITHUB_TOKEN,
    process.env.GITHUB_USERNAME
  );
}
