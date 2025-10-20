/**
 * GitHub API service for fetching user statistics
 */

interface GitHubCommitSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: any[];
}

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
 * Fetch the number of commits made by a user in the current month
 */
export async function getMonthlyCommitCount(): Promise<number> {
  const token = process.env.GITHUB_TOKEN;
  const username = process.env.GITHUB_USERNAME;

  if (!token || !username) {
    console.error('GitHub credentials not found in environment variables');
    return 0;
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
      return 0;
    }

    const data = await response.json() as GitHubCommitSearchResponse;
    return data.total_count;
  } catch (error) {
    console.error('Error fetching GitHub commit count:', error);
    return 0;
  }
}
