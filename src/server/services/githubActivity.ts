import type { GitHubContributionDay, GitHubYearlyActivity } from "./github";

export type { GitHubYearlyActivity } from "./github";

const numberFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${numberFormatter.format(count)} ${count === 1 ? singular : plural}`;
}

function formatDay(day: GitHubContributionDay) {
  const date = new Date(`${day.date}T00:00:00Z`);
  const label = Number.isNaN(date.getTime())
    ? "Unknown date"
    : dateFormatter.format(date);
  return `${formatCount(day.count, "contribution")} on ${label}`;
}

function renderHeatmap(activity: GitHubYearlyActivity) {
  const cellSize = 8;
  const cellStep = 10;
  const width = Math.max(
    cellSize,
    activity.weeks.length * cellStep - (cellStep - cellSize)
  );
  const cells = activity.weeks
    .flatMap((week, weekIndex) =>
      week.map(
        (day) =>
          `<rect x="${weekIndex * cellStep}" y="${day.weekday * cellStep}" width="${cellSize}" height="${cellSize}" rx="1.5" data-level="${day.level}"><title>${formatDay(day)}</title></rect>`
      )
    )
    .join("");

  return `
    <svg
      class="github-activity__heatmap"
      viewBox="0 0 ${width} 68"
      role="img"
      aria-label="${numberFormatter.format(activity.totalContributions)} GitHub contributions in the past year"
      preserveAspectRatio="xMinYMin meet"
    >${cells}
    </svg>`;
}

function githubProfileUrl(username: string) {
  const safeUsername = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)
    ? username
    : "";
  return safeUsername
    ? `https://github.com/${safeUsername}`
    : "https://github.com";
}

export function renderGitHubActivityPanel(
  activity: GitHubYearlyActivity | null,
  username: string
) {
  const profileUrl = githubProfileUrl(username);

  if (!activity) {
    return `
      <div
        class="github-activity__panel github-activity__panel--empty"
        id="github-activity-panel"
      >
        <span class="github-activity__eyebrow">Past year</span>
        <p>Yearly activity unavailable</p>
        <a href="${profileUrl}" target="_blank" rel="noreferrer">View GitHub</a>
      </div>`;
  }

  return `
    <div
      class="github-activity__panel"
      id="github-activity-panel"
      aria-label="GitHub activity for the past year"
    >
      <header class="github-activity__header">
        <span class="github-activity__eyebrow">Past year</span>
        <p>${formatCount(activity.totalContributions, "contribution")} in the past year</p>
      </header>
      <div class="github-activity__map-frame">
        ${renderHeatmap(activity)}
      </div>
      <footer class="github-activity__footer">
        <span>${formatCount(activity.totalCommitContributions, "commit")}</span>
        <a href="${profileUrl}" target="_blank" rel="noreferrer">
          View GitHub
          <span aria-hidden="true">↗</span>
        </a>
      </footer>
    </div>`;
}
