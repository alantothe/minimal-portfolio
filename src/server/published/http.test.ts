import { describe, expect, test } from "bun:test";
import { publishedResponse } from "./http";

describe("database-backed public response caching", () => {
  test("emits a rendered-body ETag and answers an unchanged body with 304", async () => {
    const request = new Request("https://portfolio.test/api/page?name=home");
    const first = publishedResponse(request, {
      body: JSON.stringify({ content: "Home" }),
      contentType: "application/json",
      etagSeed: "generation-1:/",
    });
    const etag = first.headers.get("ETag");
    const second = publishedResponse(
      new Request(request, { headers: { "If-None-Match": etag! } }),
      {
        body: JSON.stringify({ content: "Home" }),
        contentType: "application/json",
        etagSeed: "generation-1:/",
      }
    );

    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("no-cache");
    expect(etag).not.toBeNull();
    expect(second.status).toBe(304);
    expect(second.headers.get("ETag")).toBe(etag);
    expect(await second.text()).toBe("");
  });

  test("changes the validator when the publication generation changes", () => {
    const request = new Request("https://portfolio.test/");
    const response = (generation: string) =>
      publishedResponse(request, {
        body: "<!doctype html>",
        contentType: "text/html; charset=utf-8",
        etagSeed: `${generation}:/`,
      });

    expect(response("generation-1").headers.get("ETag")).not.toBe(
      response("generation-2").headers.get("ETag")
    );
  });

  test("changes the validator when enrichment changes within one generation", () => {
    const request = new Request("https://portfolio.test/");
    const response = (commits: number) =>
      publishedResponse(request, {
        body: `${commits} commits this month`,
        contentType: "text/html; charset=utf-8",
        etagSeed: "generation-1:/",
      });

    expect(response(468).headers.get("ETag")).not.toBe(
      response(572).headers.get("ETag")
    );
  });
});
