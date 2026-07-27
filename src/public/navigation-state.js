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
