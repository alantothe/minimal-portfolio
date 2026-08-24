export const MOBILE_PAGE_ORDER = ["home", "about", "projects", "blog"];

const MOBILE_SWIPE_MIN_DISTANCE = 64;
const MOBILE_SCROLL_EDGE_TOLERANCE = 2;
const MOBILE_SWIPE_COOLDOWN_MS = 650;
const MOBILE_SWIPE_VERTICAL_DOMINANCE = 1.25;

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
    verticalDistance <= Math.abs(deltaX) * MOBILE_SWIPE_VERTICAL_DOMINANCE
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

export function canStartMobilePageSwipe({
  isMobile,
  isNavigating,
  touchCount,
  menuOpen,
  dialogOpen,
  targetIsInteractive,
}) {
  return (
    isMobile &&
    !isNavigating &&
    touchCount === 1 &&
    !menuOpen &&
    !dialogOpen &&
    !targetIsInteractive
  );
}

export function canFinishMobilePageSwipe({
  isMobile,
  isNavigating,
  changedTouchCount,
  remainingTouchCount,
}) {
  return (
    isMobile &&
    !isNavigating &&
    changedTouchCount === 1 &&
    remainingTouchCount === 0
  );
}

/**
 * Keep touch lifecycle, edge arming, and repeat protection behind one small
 * stateful interface. Browser eligibility and target filtering stay with the
 * router; gesture decisions stay here.
 */
export function createMobilePageSwipeRecognizer() {
  let gestureStart = null;
  let cooldownUntil = 0;

  return {
    start({ x, y, scrollTop, scrollHeight, clientHeight }) {
      const boundaries = getScrollBoundaries({
        scrollTop,
        scrollHeight,
        clientHeight,
      });

      gestureStart =
        boundaries.atTop || boundaries.atBottom
          ? {
              x,
              y,
              startedAtTop: boundaries.atTop,
              startedAtBottom: boundaries.atBottom,
            }
          : null;
    },

    cancel() {
      gestureStart = null;
    },

    finish({ x, y, pageName, now }) {
      const start = gestureStart;
      gestureStart = null;

      if (!start || now < cooldownUntil) {
        return null;
      }

      const intent = getBoundarySwipeIntent({
        startX: start.x,
        startY: start.y,
        endX: x,
        endY: y,
        startedAtTop: start.startedAtTop,
        startedAtBottom: start.startedAtBottom,
      });
      const targetPage = intent
        ? getAdjacentMobilePage(pageName, intent)
        : null;

      if (!intent || !targetPage) {
        return null;
      }

      cooldownUntil = now + MOBILE_SWIPE_COOLDOWN_MS;
      return targetPage;
    },
  };
}
