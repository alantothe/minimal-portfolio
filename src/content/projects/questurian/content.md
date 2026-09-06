---
title: Questurian Frontend
description: "Questura's public frontend uses Next.js, React, and TypeScript for CMS publishing, Stripe memberships, technical SEO, and interactive Google Maps."
image: "https://res.cloudinary.com/dz18m79a1/image/upload/c_fill,w_300,h_180/v1761780791/questura_rbayjx.png"
kicker: "Public travel frontend"
role: "Founding Engineer"
status: "Active product"
year: "2025–present"
order: 1
date: 2026-07-27
repository: "https://github.com/Questurian/questurian"
stack:
  - Next.js
  - React
  - TypeScript
  - Tailwind CSS
  - Google Maps
  - Stripe
accent: "#67A8A3"
---

## Building a publication that behaves like a product

I built Questura's public frontend as its founding engineer. It is a travel publishing platform organized around places: country hubs lead into city guides, neighborhoods, editorial articles, maps, itineraries, search, bookmarks, accounts, and membership content.

The difficult part was not producing another set of React pages. Questura needed public content to load like a publication, rank like an SEO-focused website, personalize itself for signed-in visitors, protect paid content, and support rich map interactions without making every request dynamic.

My work here focuses on frontend architecture and implementation. Questura Server owns content storage, authentication, pricing, and entitlement decisions. The client owns rendering, navigation, interaction, responsive behavior, accessibility, and the experience delivered to visitors.

## My role and ownership

I designed and implemented the client architecture across more than 30 Next.js routes and 11 feature domains. That work includes:

- public country, city, neighborhood, article, map, itinerary, author, and search experiences
- authenticated account, bookmark, membership, and subscription interfaces
- typed API integration between the Next.js client and Questura Server
- static rendering, cache invalidation, metadata, canonical routing, and structured data
- responsive editorial layouts and reusable CMS-configured page sections
- Google Maps interactions, custom camera behavior, and mobile map modes
- performance work around hydration, fonts, images, third-party embeds, and expensive map initialization

The frontend uses Next.js 15, React 19, strict TypeScript, Tailwind CSS, TanStack Query, Zustand, Google Maps, and server-orchestrated Stripe checkout.

## Architecture at a glance

```text
Questura Server
content · auth · search · payments · entitlements
        │
        └── stable public view models
                    │
                    v
         Next.js Server Components
         static pages · ISR · SEO
                    │
                    v
            React client islands
       maps · bookmarks · auth · membership
```

Public editorial routes are static by default and revalidate incrementally. Session-dependent routes such as account, bookmarks, search, and membership remain dynamic. Interactive features hydrate only where browser state or direct manipulation is required.

That split keeps article HTML fast and crawlable while preserving product behavior where it matters.

## Static publishing with targeted revalidation

Questura uses Next.js App Router groups as architectural boundaries. Public routes use static rendering with Incremental Static Regeneration, while private and query-dependent routes use dynamic rendering.

Public data requests carry tags for individual articles, locations, indexes, and sitemaps. When editorial content changes, a protected revalidation endpoint can invalidate the affected tags or paths instead of rebuilding the entire publication.

This creates a focused publishing flow:

```text
editorial change
      │
      v
targeted tag or path invalidation
      │
      v
fresh static page on next request
```

I also kept large public article bodies outside the main client-state provider. Server Components fetch page data, produce metadata and JSON-LD, and render the editorial shell. Smaller client components handle maps, bookmarks, authentication prompts, and membership state. Visitors do not download and hydrate a full application just to read an article.

## A deliberate frontend boundary

The client never interprets raw CMS documents. Questura Server converts internal content into stable, page-ready view models before the frontend receives it.

This boundary keeps UI components independent from storage schemas, media processing, and internal relationships. Backend content models can evolve without forcing every React component to understand those changes.

City homepages are still editorially configurable. The server returns typed blocks containing a block type, slot count, and content. A TypeScript registry maps each supported combination to a designed React layout. Editors can change page composition while the frontend retains control over responsive behavior, accessibility, and visual quality.

That is the balance I wanted: flexible publishing without rendering arbitrary CMS markup.

## Premium content without weakening SEO

Membership content created a direct conflict. Articles should remain static and crawlable, but access depends on the current visitor.

I solved this with a public cached shell and a separate entitlement request. Anonymous HTML contains the public sample and a description of the content gate, but not the protected body. After hydration, the browser checks the visitor principal. Only an authenticated member can request the complete article.

```text
static article sample
        │
        ├── anonymous or non-member → membership prompt
        │
        └── active member → authenticated full-content request
```

This is not a cosmetic CSS paywall: premium content is withheld from the public payload. The client also distinguishes access denial from retrieval failure, so a paying member sees an honest loading error instead of being incorrectly told to subscribe again.

Checkout follows the same boundary. The client requests current plans and asks Questura Server to create a Stripe checkout or customer-portal session, then redirects to the returned URL. Pricing, payment authority, and subscription entitlements never move into browser code.

For search engines, locked articles include paywall-compatible structured data, canonical metadata, breadcrumbs, Open Graph data, and clear accessibility status.

## Maps that respond to the reader

Questura's maps are part of the editorial experience rather than isolated embeds. In listicles and itineraries, article entries and map markers share an active location.

An IntersectionObserver tracks a narrow reading band in the viewport. When an entry crosses that band, its marker becomes active and the map follows it. Clicking a marker performs the reverse interaction and scrolls the matching entry into reading position.

Passive observation and programmatic navigation can easily fight each other during smooth scrolling. I used a reducer with explicit observed and targeted states so marker navigation temporarily owns the transition, then releases control back to the observer when scrolling settles.

I also extracted map camera calculations into pure, tested TypeScript. The camera accounts for Mercator projection, fit zoom, distance, and the portion of a mobile map hidden below the viewport. Custom fly-to animation preserves geographic context across long jumps where default map movement can snap.

On mobile, visitors can move between List, Split, and Map modes. The map keeps a stable full-height canvas and moves with transforms instead of constantly resizing and reinitializing Google Maps. It mounts only after first use, then remains available off-screen for fast mode changes.

## Performance shaped by real constraints

Performance work focused on resource scheduling and rendering boundaries, not only bundle size.

- Google Maps initializes lazily, so visitors who never open it avoid its startup cost.
- Instagram embeds use a bounded warm-up queue, limiting concurrent third-party loads while allowing nearby content to jump ahead.
- Third-party embed markup lives in a memoized leaf so React 19 updates do not destroy and redownload already-initialized iframes.
- The membership landing page preloads its Largest Contentful Paint image and begins its reveal after image decoding without waiting for React hydration.
- Route-specific font loading keeps fonts unused by the membership page out of competition with its hero image.
- Prepared media URLs, intrinsic dimensions, decoding modes, and fetch priority are passed through a small public image component.

Each optimization came from a concrete product constraint: long editorial pages, slow networks, costly map initialization, or competition for early rendering resources.

## SEO and accessibility as architecture

Questura generates page titles, descriptions, canonical URLs, alternate-language links, Open Graph metadata, Twitter cards, breadcrumbs, Article JSON-LD, and paywall structured data. Canonical paths come from server-owned content contracts, and historical paths can permanently redirect instead of losing inbound links.

Internal search is rendered on the server but marked `noindex`, preventing low-value query pages from competing with editorial content. Route guards also stop reserved path segments from being interpreted as article slugs.

Accessibility decisions live alongside interaction code. Map controls expose pressed and controlled states, full-screen map modes preserve a visible exit path, and motion-heavy behaviors respect reduced-motion preferences. Loading, empty, access-denied, and failed states remain distinct so interface feedback stays accurate.

## What this Project demonstrates

Questura demonstrates how I approach senior frontend work: start with product constraints, define clear system boundaries, and choose rendering and state patterns that fit each part of the experience.

It shows practical experience with:

- Next.js App Router, React Server Components, and strict TypeScript
- static rendering, ISR, tagged caching, and on-demand revalidation
- feature-based frontend architecture and typed API contracts
- TanStack Query for remote state and Zustand for focused client state
- authentication, optimistic updates, Stripe checkout, and membership UX
- interactive Google Maps, observer-driven UI, reducers, and viewport geometry
- technical SEO, structured data, canonical routing, and accessibility
- responsive editorial design and performance engineering

Most importantly, it shows judgment across conflicting requirements: static publishing with personalization, editorial flexibility with frontend control, rich maps with mobile performance, and paid content with search visibility.
