import { expect, test } from "bun:test";
import { GitHubCommitCounter } from "./github";

test("monthly count uses account contributions within the current UTC month", async () => {
  const counter = new GitHubCommitCounter({
    now: () => new Date("2026-09-29T12:00:00Z"),
    fetch: async (url, init) => {
      if (String(url).includes("search/commits")) {
        return Response.json({
          total_count: 1509247441,
          incomplete_results: true,
        });
      }
      expect(String(url)).toBe("https://api.github.com/graphql");
      const body = JSON.parse(String(init?.body));
      expect(body.variables).toEqual({
        username: "alanmalpartida",
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-29T12:00:00.000Z",
      });
      expect(body.query).toContain("totalCommitContributions");
      return Response.json({
        data: {
          user: { contributionsCollection: { totalCommitContributions: 239 } },
        },
      });
    },
  });
  expect(await counter.getMonthlyCommitCount("token", "alanmalpartida")).toBe(
    239
  );
});

test.each([
  { data: { user: null } },
  {
    errors: [{ message: "unavailable" }],
    data: {
      user: { contributionsCollection: { totalCommitContributions: 239 } },
    },
  },
  ...[-1, 1.5, "239", null].map((totalCommitContributions) => ({
    data: { user: { contributionsCollection: { totalCommitContributions } } },
  })),
])("does not publish an invalid account count: %j", async (payload) => {
  const counter = new GitHubCommitCounter({
    fetch: async () => Response.json(payload),
  });
  expect(await counter.getMonthlyCommitCount("token", "alanmalpartida")).toBe(
    0
  );
});
