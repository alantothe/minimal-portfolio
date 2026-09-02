---
title: Questurian Frontend
description: "The public frontend for Questurian, built with TypeScript and CSS to turn structured travel content into location-first discovery."
image: "https://res.cloudinary.com/dz18m79a1/image/upload/c_fill,w_300,h_180/v1761780791/questura_rbayjx.png"
kicker: "Public travel frontend"
role: "Founding Engineer"
status: "Active product"
year: "2025–present"
order: 1
date: 2026-07-27
repository: "https://github.com/Questurian/questurian"
stack:
  - TypeScript
  - CSS
accent: "#67A8A3"
---

## Context

Questurian Frontend is the public travel discovery experience. It organizes content around structured places rather than a flat stream of articles, with country, city, and neighborhood pages connecting editorial stories to dining, accommodation, attractions, nightlife, tours, maps, and currency information.

This case study covers the frontend only. Questurian's CMS, data services, location manager, and AI tooling are separate projects. The frontend receives reviewed, page-ready data and focuses on turning it into a clear visitor experience.

## What I built

- Hierarchical country, city, and neighborhood routes that make location the primary navigation model.
- Responsive TypeScript components for editorial content, discovery surfaces, maps, visitor accounts, and paid-content entry points.
- A CSS system that keeps dense travel pages readable across phones and larger screens without losing visual hierarchy.
- Reusable page sections that render stable frontend view models instead of exposing internal content records to components.
- Clear loading, empty, error, and incomplete-content states so the interface remains useful when optional travel data is unavailable.

## How it works

```text
reviewed content
       │
       v
public view models ─> TypeScript frontend ─> country / city / neighborhood
                              │
                              └─────────────> responsive CSS presentation
```

The frontend consumes stable public view models. Components do not read raw CMS records, coordinate editorial workflows, or run AI pipelines. That boundary keeps frontend code focused on navigation, presentation, interaction, and accessibility.

## Engineering decisions

**Keep frontend scope explicit.** The public site is separate from CMS and production tooling. Integration happens through page-ready contracts, so frontend components do not need to understand how content was authored or enriched.

**Organize navigation around places.** Route and page structure follow the way travelers explore: broad country context narrows into cities and neighborhoods, while discovery modules preserve that location context.

**Render stable contracts.** Page-ready view models keep content schema and media-processing details outside UI components. Each card, hero, and content section receives a predictable shape.

**Use CSS to preserve hierarchy.** Layout, spacing, typography, and responsive rules make long travel pages scannable without flattening every content type into the same card.

**Design for partial data.** Travel content grows over time. Frontend states distinguish unavailable optional information from broken required content, allowing useful pages without pretending every destination is complete.

## What this demonstrates

Questurian Frontend demonstrates frontend architecture in TypeScript, maintainable CSS, responsive information design, and clear boundaries between public UI and production systems.
