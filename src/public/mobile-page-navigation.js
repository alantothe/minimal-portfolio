export const MOBILE_PAGE_ORDER = ["home", "about", "projects", "blog"];

export const MOBILE_SWIPE_MIN_DISTANCE = 64;
export const MOBILE_SCROLL_EDGE_TOLERANCE = 2;

/**
 * Return which boundary the scroll container currently touches. Short pages
 * intentionally touch both boundaries so swipe direction can decide the route.
 */
export function getScrollBoundaries({ scrollTop, scrollHeight, clientHeight }) {
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);

  return {
    atTop: scrollTop <= MOBILE_SCROLL_EDGE_TOLERANCE,
    atBottom: scrollTop >= maxScrollTop - MOBILE_SCROLL_EDGE_TOLERANCE,
  };
}

/**
 * Interpret one completed, single-finger gesture that began at a page edge.
 * Finger movement up advances; finger movement down returns to the prior page.
 */
export function getBoundarySwipeIntent({
  startX,
  startY,
  endX,
  endY,
  startedAtTop,
  startedAtBottom,
}) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const verticalDistance = Math.abs(deltaY);

  if (
    verticalDistance < MOBILE_SWIPE_MIN_DISTANCE ||
    verticalDistance <= Math.abs(deltaX)
  ) {
    return null;
  }

  if (deltaY < 0 && startedAtBottom) {
    return "next";
  }

  if (deltaY > 0 && startedAtTop) {
    return "previous";
  }

  return null;
}

/** Resolve an adjacent top-level page without wrapping at either end. */
export function getAdjacentMobilePage(pageName, intent) {
  const currentIndex = MOBILE_PAGE_ORDER.indexOf(pageName);
  if (currentIndex === -1) {
    return null;
  }

  const offset = intent === "next" ? 1 : intent === "previous" ? -1 : 0;
  if (offset === 0) {
    return null;
  }

  return MOBILE_PAGE_ORDER[currentIndex + offset] ?? null;
}
