import { describe, expect, test } from "bun:test";
import {
  collectionPath,
  getCollectionPage,
  pageCacheKey,
} from "../public/navigation-state.js";

describe("collection navigation state", () => {
  test.each([
    ["", 1],
    ["?page=1", 1],
    ["?page=2", 2],
    ["?page=not-a-number", 1],
    ["?page=-1", 1],
  ])("normalizes %p to page %i", (search, expected) => {
    expect(getCollectionPage(search)).toBe(expected);
  });

  test("omits the duplicate page=1 query", () => {
    expect(collectionPath("blog", 1)).toBe("/blog");
    expect(collectionPath("projects", 2)).toBe("/projects?page=2");
  });

  test("keeps cached collection pages distinct", () => {
    expect(pageCacheKey("projects", 1)).toBe("projects:1");
    expect(pageCacheKey("projects", 2)).toBe("projects:2");
    expect(pageCacheKey("about", 1)).toBe("about");
  });
});
