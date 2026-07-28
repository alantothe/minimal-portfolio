---
title: Minimal Portfolio
description: A source-controlled portfolio and publishing system with server-rendered pages, SPA navigation, durable view tracking, and production web safeguards.
kicker: Personal publishing · Web platform
role: Designer and full-stack engineer
status: "Live portfolio"
year: 2026
order: 6
date: 2026-07-27
repository: https://github.com/alantothe/minimal-portfolio
stack:
  - Bun
  - TypeScript
  - HTML + CSS
  - Markdown
  - Railway
accent: "#8AA0B2"
---

## Context

I wanted a portfolio that stayed small enough to understand end to end, but did not treat performance, accessibility, search discovery, or deployment behavior as afterthoughts. I built the site as a source-controlled publishing system: profile data lives in one configuration module, articles live in Markdown, and the Bun server turns both into production pages.

The minimal interface is intentional. Most of the engineering sits beneath it: direct routes must return useful HTML, in-site navigation should feel immediate, view counts must survive restarts, metadata must stay consistent, and invalid production configuration should fail before traffic arrives.

## What I built

The application uses a custom TypeScript HTTP stack on Bun rather than an application framework. It includes a parameterized router, static-file handler, Markdown and frontmatter pipeline, server-rendered page shell, fragment APIs, and plain-browser JavaScript for SPA navigation.

I added the supporting systems needed to run it as a real public site:

- server-rendered home, about, blog, project, and paginated collection routes
- client-side navigation with history restoration and page-aware caching
- canonical, Open Graph, Twitter, and structured metadata derived from site config
- sitemap and robots endpoints generated from published content
- ETags, conditional static responses, gzip compression, and route-specific CSS
- atomic JSON view persistence with serialized writes and visitor cooldowns
- cached GitHub commit data with stale fallback during API outages
- content scaffolding scripts, deployment health checks, CI, and Railway configuration

## How it works

```text
Markdown + site config
          |
          v
 parsing, collections, SEO services
          |
          v
 Bun request handler
    |             |
    |             +--> static assets + ETag cache
    v
 custom router
    |
    +--> SSR shell for direct requests and crawlers
    |
    +--> fragment APIs for later navigation
                         |
                         v
                 browser SPA router
                 history + page cache
```

A direct visit renders the requested route into the HTML shell before it leaves the server. Once loaded, the browser router intercepts internal links, requests only the next content fragment, updates metadata, and preserves collection-page state in browser history. The same content services feed both paths, so server rendering and SPA navigation do not maintain separate versions of a page.

## Engineering decisions

**Use progressive enhancement as the architecture.** Server-rendered content makes every article and collection link useful without waiting for client JavaScript. The SPA layer enhances later navigation instead of replacing the initial document.

**Derive identity and discovery data from one source.** Page titles, social metadata, canonical URLs, and structured profile data use the portfolio configuration. Published Markdown drives collection pages and sitemap entries, reducing opportunities for navigation and search indexes to drift apart.

**Choose storage proportionate to the deployment.** View counts use a JSON file because the site runs as one always-on instance. Mutations are queued, writes use a temporary file plus atomic rename, and deployment docs state the boundary: move to shared storage before running multiple replicas.

**Make HTTP behavior deliberate.** The server handles `HEAD` and `OPTIONS`, rejects unsupported methods, returns real 404 and 500 responses, prevents unsafe content slugs, validates its public production origin, and applies different cache policies to assets and HTML.

**Test behavior at system boundaries.** The suite exercises routing, SSR, SPA state, pagination, SEO, discovery files, view concurrency, cooldown rules, static caching, compression, and production configuration. These tests protect observable contracts while allowing the small internals to keep changing.

## What this demonstrates

Minimal Portfolio shows full-stack ownership at a deliberately small scale. I handled content modeling, rendering, browser navigation, HTTP semantics, persistence, search discovery, tests, and deployment as one coherent product. It also reflects how I make tradeoffs: keep dependencies and infrastructure modest, document the operating limits, and invest complexity only where public behavior requires it.
