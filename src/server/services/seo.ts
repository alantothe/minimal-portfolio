export type SeoPageInput =
  | { kind: 'home' }
  | { kind: 'about' }
  | { kind: 'blog'; page: number }
  | { kind: 'projects'; page: number }
  | {
      kind: 'blog-post';
      slug: string;
      title: string;
      description: string;
      date: string | Date;
    }
  | {
      kind: 'project';
      slug: string;
      title: string;
      description: string;
    };

export interface SeoMetadata {
  title: string;
  description: string;
  canonical: string;
  type: 'website' | 'article';
  image: string;
  publishedTime?: string;
  structuredData?: Record<string, unknown>;
}

function getSiteOrigin(requestUrl: URL): string {
  const configuredUrl = process.env.SITE_URL?.trim();
  if (!configuredUrl) {
    return requestUrl.origin;
  }

  try {
    const parsed = new URL(configuredUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    // Fall through to request origin when SITE_URL is invalid.
  }

  return requestUrl.origin;
}

function withPage(path: string, page?: number): string {
  return page && page > 1 ? `${path}?page=${page}` : path;
}

export function getCanonicalUrl(input: SeoPageInput, requestUrl: URL): string {
  const origin = getSiteOrigin(requestUrl);
  let path: string;

  switch (input.kind) {
    case 'home':
      path = '/';
      break;
    case 'about':
      path = '/about';
      break;
    case 'blog':
      path = withPage('/blog', input.page);
      break;
    case 'projects':
      path = withPage('/projects', input.page);
      break;
    case 'blog-post':
      path = `/blog/${encodeURIComponent(input.slug)}`;
      break;
    case 'project':
      path = `/projects/${encodeURIComponent(input.slug)}`;
      break;
  }

  return new URL(path, `${origin}/`).toString();
}

function personSchema(origin: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${origin}/#alan-malpartida`,
    name: 'Alan Malpartida',
    url: `${origin}/`,
    image: `${origin}/avatar.webp`,
    jobTitle: 'Founding Engineer at Questurian',
    sameAs: ['https://github.com/alantothe'],
  };
}

export function createSeoMetadata(
  input: SeoPageInput,
  requestUrl: URL,
): SeoMetadata {
  const canonical = getCanonicalUrl(input, requestUrl);
  const origin = new URL(canonical).origin;
  const image = `${origin}/avatar.webp`;
  const person = personSchema(origin);

  switch (input.kind) {
    case 'home':
      return {
        title: 'Alan Malpartida — Software Engineer & Founding Engineer',
        description: 'Alan Malpartida is a full-stack software engineer and founding engineer at Questurian, building web platforms and sharing technical projects.',
        canonical,
        type: 'website',
        image,
        structuredData: person,
      };
    case 'about':
      return {
        title: 'About Alan Malpartida',
        description: 'Learn about Alan Malpartida, his software engineering background, current work at Questurian, and selected interests.',
        canonical,
        type: 'website',
        image,
        structuredData: {
          '@context': 'https://schema.org',
          '@type': 'ProfilePage',
          mainEntity: person,
        },
      };
    case 'blog':
      return {
        title: input.page > 1
          ? `Alan Malpartida’s Software Engineering Blog — Page ${input.page}`
          : 'Alan Malpartida’s Software Engineering Blog',
        description: 'Software engineering, architecture, startup building, and project notes from Alan Malpartida.',
        canonical,
        type: 'website',
        image,
      };
    case 'projects':
      return {
        title: input.page > 1
          ? `Software Projects by Alan Malpartida — Page ${input.page}`
          : 'Software Projects by Alan Malpartida',
        description: 'Selected software projects built and contributed to by Alan Malpartida, with implementation details and technical context.',
        canonical,
        type: 'website',
        image,
      };
    case 'blog-post':
      const publishedTime = input.date instanceof Date
        ? input.date.toISOString()
        : input.date;
      return {
        title: `${input.title} | Alan Malpartida`,
        description: input.description,
        canonical,
        type: 'article',
        image,
        publishedTime,
        structuredData: {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: input.title,
          description: input.description,
          datePublished: publishedTime,
          mainEntityOfPage: canonical,
          author: {
            '@id': person['@id'],
            '@type': 'Person',
            name: person.name,
            url: person.url,
          },
        },
      };
    case 'project':
      return {
        title: `${input.title} | Alan Malpartida`,
        description: input.description,
        canonical,
        type: 'website',
        image,
      };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeJson(value: Record<string, unknown>): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

export function renderSeoHead(metadata: SeoMetadata): string {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const canonical = escapeHtml(metadata.canonical);
  const image = escapeHtml(metadata.image);
  const publishedTime = metadata.publishedTime
    ? `\n    <meta property="article:published_time" content="${escapeHtml(metadata.publishedTime)}">`
    : '';
  const structuredData = metadata.structuredData
    ? `\n    <script type="application/ld+json">${safeJson(metadata.structuredData)}</script>`
    : '';

  return `<title>${title}</title>
    <meta name="description" content="${description}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:site_name" content="Alan Malpartida">
    <meta property="og:type" content="${metadata.type}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${image}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${image}">${publishedTime}${structuredData}`;
}
