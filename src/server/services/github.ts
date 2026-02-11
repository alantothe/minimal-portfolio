/**
 * GitHub API service for fetching user statistics
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

interface GitHubCommitSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: any[];
}

interface CommitCache {
  lastMonth: {
    date: string;
    count: number;
  };
  currentMonth: {
    date: string;
    count: number;
  };
}

const CACHE_FILE = './src/data/github-commits.json';

/**
 * Get the date range for the current month
 */
function getCurrentMonthDateRange(): { start: string; end: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  // First day of current month
  const start = new Date(year, month, 1);

  // Last day of current month (first day of next month minus 1 day)
  const end = new Date(year, month + 1, 0);

  // Format as YYYY-MM-DD
  const formatDate = (date: Date): string => {
    return date.toISOString().split('T')[0] || '';
  };

  return {
    start: formatDate(start),
    end: formatDate(end)
  };
}

/**
 * Get the current month identifier (YYYY-MM)
 */
function getCurrentMonthId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Load cache from file
 */
async function loadCache(): Promise<CommitCache> {
  try {
    const data = await readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // Cache file doesn't exist or is invalid, return default
    return {
      lastMonth: { date: '', count: 0 },
      currentMonth: { date: '', count: 0 }
    };
  }
}

/**
 * Save cache to file
 */
async function saveCache(cache: CommitCache): Promise<void> {
  try {
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.error('Error saving GitHub commits cache:', error);
  }
}

/**
 * Fetch the number of commits made by a user in the current month
 */
export async function getMonthlyCommitCount(): Promise<number> {
  const token = process.env.GITHUB_TOKEN;
  const username = process.env.GITHUB_USERNAME;

  if (!token || !username) {
    console.error('GitHub credentials not found in environment variables');
    // Return cached value if available
    const cache = await loadCache();
    return cache.currentMonth.count;
  }

  const currentMonthId = getCurrentMonthId();
  const cache = await loadCache();

  // Check if we've moved to a new month
  if (cache.currentMonth.date !== currentMonthId) {
    // Shift current to last month
    cache.lastMonth = cache.currentMonth;
  }

  try {
    const { start, end } = getCurrentMonthDateRange();

    // github api to find commits by author in date range
    const query = `author:${username} author-date:${start}..${end}`;
    const url = `https://api.github.com/search/commits?q=${encodeURIComponent(query)}&per_page=1`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (!response.ok) {
      console.error(`GitHub API error: ${response.status} ${response.statusText}`);

      // Use cached value on API failure
      const cachedValue = cache.currentMonth.count;
      if (cachedValue > 0) {
        console.log(`[GitHub Cache] API failed, using cached value: ${cachedValue} commits`);
      }
      return cachedValue;
    }

    const data = await response.json() as GitHubCommitSearchResponse;
    const newCount = data.total_count;

    // Calculate difference from previous value
    const oldCount = cache.currentMonth.count;
    const difference = newCount - oldCount;

    // Update cache with new count
    cache.currentMonth.date = currentMonthId;
    cache.currentMonth.count = newCount;
    await saveCache(cache);

    // Log the result
    if (difference !== 0) {
      console.log(`[GitHub Commits] ${newCount} commits this month (+${difference} since last update)`);
    } else {
      console.log(`[GitHub Commits] ${newCount} commits this month (no change)`);
    }

    return newCount;
  } catch (error) {
    console.error('Error fetching GitHub commit count:', error);

    // Use cached value on error
    const cachedValue = cache.currentMonth.count;
    if (cachedValue > 0) {
      console.log(`[GitHub Cache] Error during fetch, using cached value: ${cachedValue} commits`);
    }
    return cachedValue;
  }
}
