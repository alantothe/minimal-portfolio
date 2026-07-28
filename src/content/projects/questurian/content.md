---
title: Questurian
description: "A full-stack travel publishing platform connecting structured destination data, editorial tooling, media pipelines, and location-first discovery."
image: "https://res.cloudinary.com/dz18m79a1/image/upload/c_fill,w_300,h_180/v1761780791/questura_rbayjx.png"
kicker: "Travel publishing platform"
role: "Founding Engineer"
status: "Active product"
year: "2025–present"
order: 1
date: 2026-07-27
repository: "https://github.com/Questurian/questurian"
stack:
  - Next.js
  - TypeScript
  - Payload CMS
  - PostgreSQL
  - FastAPI
  - Vertex AI
accent: "#67A8A3"
---

## Context

Questurian is a travel publishing and discovery product built around structured places rather than a flat stream of articles. Country, city, and neighborhood pages combine editorial content with dining, accommodation, attraction, nightlife, tour, map, and currency data.

As a founding engineer, I worked across the public product and the internal systems that feed it. The central challenge was keeping those systems coordinated without letting CMS records, AI generation, or media-processing details leak into the visitor experience.

## What I built

- A Next.js public application with hierarchical location routes, internationalization, search and discovery surfaces, maps, accounts, and paid-content flows.
- A Payload CMS and PostgreSQL backend that owns the public content model, editorial records, location taxonomy, media, access rules, and server-side integrations.
- Operator workflows that turn researched location data and generated drafts into reviewable CMS entities instead of publishing model output directly.
- A media pipeline built around reusable `MediaSet` records, focal points, placement-specific readiness, and generated image variants.
- Curated location homepages with draft and published states, ordered content blocks, and validation that keeps incomplete references from replacing a valid live page.

## How it works

```text
Location research ──┐
                    ├─> operator tools ─> reviewed draft ─> Payload + PostgreSQL
AI editorial runs ──┘                                  │
                                                       ├─> public view models
source image ─> crop/variant pipeline ─> MediaSet ─────┤
                                                       v
                                              Next.js SSR pages
                                                       │
                                                       v
                                          country / city / neighborhood
```

Internal tools own enrichment and article generation. Questurian's backend remains the source of truth: it validates writes, stores editorial state, resolves media for each placement, and exposes public view models. The Next.js client renders those stable contracts rather than reading raw Payload documents or choosing image variants itself.

## Engineering decisions

**Separate production from production tooling.** The public site, CMS, location manager, and AI writer are distinct bounded contexts inside one pnpm/Turborepo workspace. Each owns its vocabulary and persistence while integration happens through explicit APIs and sync operations.

**Resolve presentation at the server boundary.** Public view models turn CMS documents into page-ready data. This keeps collection schema changes and media internals away from SSR components, while giving each card, hero, or social placement a predictable image shape.

**Treat images as systems, not attachments.** A retained source image and focal point can produce multiple required crops. Readiness is evaluated per placement, so a square card may be usable even when a hero crop still needs editorial attention.

**Publish complete page snapshots.** Editors work on a private homepage draft. Before publication, references, slot requirements, content status, and media placement readiness are checked together; the existing published snapshot stays available when a candidate has blockers.

**Keep identities and entitlements explicit.** Staff access, visitor accounts, and paid-content membership serve different trust boundaries. Keeping them separate avoids turning a CMS role or an internal operator session into a public customer entitlement.

## What this demonstrates

Questurian shows my ability to work across product UI, domain modeling, content systems, media infrastructure, authentication, payments, and AI-assisted operations. More importantly, it demonstrates how I turn a broad product into clear service boundaries and contracts that can evolve without making the public experience depend on internal implementation details.
