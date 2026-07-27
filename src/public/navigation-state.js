const collectionPages = new Set(["blog", "projects"]);

export function getCollectionPage(search) {
  const rawPage = new URLSearchParams(search).get("page");
  const page = Number(rawPage || 1);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function collectionPath(pageName, pageNumber) {
  return pageNumber > 1
    ? `/${pageName}?page=${pageNumber}`
    : `/${pageName}`;
}

export function pageCacheKey(pageName, pageNumber = 1) {
  return collectionPages.has(pageName)
    ? `${pageName}:${pageNumber}`
    : pageName;
}

export function isCollectionPage(pageName) {
  return collectionPages.has(pageName);
}

export function blogPostApiPath(slug, visitorId) {
  const path = `/api/blog/${encodeURIComponent(slug)}`;
  if (!visitorId) {
    return path;
  }

  const query = new URLSearchParams({
    view: "1",
    visitor: visitorId,
  });
  return `${path}?${query}`;
}
