import { describe, expect, test } from "bun:test";
import {
  getAdjacentMobilePage,
  getBoundarySwipeIntent,
  getScrollBoundaries,
  MOBILE_PAGE_ORDER,
} from "../public/mobile-page-navigation.js";

describe("mobile page navigation decisions", () => {
  test("defines the top-level page order", () => {
    expect(MOBILE_PAGE_ORDER).toEqual(["home", "about", "projects", "blog"]);
  });

  test.each([
    ["home", "next", "about"],
    ["about", "next", "projects"],
    ["projects", "next", "blog"],
    ["blog", "previous", "projects"],
    ["about", "previous", "home"],
  ])("moves from %s toward %s", (page, intent, expected) => {
    expect(getAdjacentMobilePage(page, intent)).toBe(expected);
  });

  test("does not wrap or navigate detail pages", () => {
    expect(getAdjacentMobilePage("home", "previous")).toBeNull();
    expect(getAdjacentMobilePage("blog", "next")).toBeNull();
    expect(getAdjacentMobilePage("blog-post", "next")).toBeNull();
    expect(getAdjacentMobilePage("project", "previous")).toBeNull();
  });

  test("detects scroll edges with a small rounding tolerance", () => {
    expect(
      getScrollBoundaries({
        scrollTop: 1,
        scrollHeight: 1000,
        clientHeight: 400,
      })
    ).toEqual({ atTop: true, atBottom: false });
    expect(
      getScrollBoundaries({
        scrollTop: 599,
        scrollHeight: 1000,
        clientHeight: 400,
      })
    ).toEqual({ atTop: false, atBottom: true });
  });

  test("treats a short page as both top and bottom", () => {
    expect(
      getScrollBoundaries({
        scrollTop: 0,
        scrollHeight: 300,
        clientHeight: 400,
      })
    ).toEqual({ atTop: true, atBottom: true });
  });

  test("advances only when an upward swipe began at the bottom", () => {
    expect(
      getBoundarySwipeIntent({
        startX: 20,
        startY: 180,
        endX: 24,
        endY: 100,
        startedAtTop: false,
        startedAtBottom: true,
      })
    ).toBe("next");

    expect(
      getBoundarySwipeIntent({
        startX: 20,
        startY: 180,
        endX: 24,
        endY: 100,
        startedAtTop: false,
        startedAtBottom: false,
      })
    ).toBeNull();
  });

  test("returns only when a downward swipe began at the top", () => {
    expect(
      getBoundarySwipeIntent({
        startX: 20,
        startY: 100,
        endX: 24,
        endY: 180,
        startedAtTop: true,
        startedAtBottom: false,
      })
    ).toBe("previous");

    expect(
      getBoundarySwipeIntent({
        startX: 20,
        startY: 100,
        endX: 24,
        endY: 180,
        startedAtTop: false,
        startedAtBottom: false,
      })
    ).toBeNull();
  });

  test("rejects short and mostly horizontal gestures", () => {
    expect(
      getBoundarySwipeIntent({
        startX: 20,
        startY: 180,
        endX: 20,
        endY: 130,
        startedAtTop: false,
        startedAtBottom: true,
      })
    ).toBeNull();

    expect(
      getBoundarySwipeIntent({
        startX: 20,
        startY: 180,
        endX: 100,
        endY: 110,
        startedAtTop: false,
        startedAtBottom: true,
      })
    ).toBeNull();
  });
});
