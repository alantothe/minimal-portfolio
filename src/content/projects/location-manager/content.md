---
title: Location Manager
description: An internal location-ingestion and publishing system that turns source links and media into structured, reviewable CMS records.
kicker: Editorial operations · Location data
role: Founding engineer
status: "Internal platform"
year: 2026
order: 5
date: 2026-07-27
repository: https://github.com/Questurian/location-utils
stack:
  - React 19
  - TypeScript
  - Bun + Hono
  - SQLite
  - Payload CMS
  - Python + BLIP
accent: "#C5A46C"
---

## Context

I built Location Manager as the internal ingestion layer behind Questurian's location content. A place begins as a Google Maps source, editorial fields, and a set of images or Instagram references. The system turns those inputs into one structured record that can be reviewed, enriched, and synchronized with Payload CMS.

This is more than a data-entry screen. Location identity, geographic hierarchy, media variants, attribution, accessibility text, and CMS references must remain connected across edits and repeat syncs.

## What I built

I designed the project as a Turborepo monorepo with four cooperating packages: a React admin client, a Bun/Hono API, framework-agnostic shared TypeScript contracts, and an optional Python image-captioning service.

The admin application supports location creation and editing, category and geography filters, media review, taxonomy approval, and a dedicated Payload sync dashboard. TanStack Query owns server state, while React Hook Form and Zod keep form validation aligned with API expectations.

On the server, I separated HTTP controllers from domain services and SQLite repositories. The location workflow covers:

- Google Maps URL generation and geocoding
- country, city, and neighborhood taxonomy with pending-review states
- correction rules for inconsistent geographic names
- direct uploads and Instagram-linked media
- five cropped image variants for each image set
- optional BLIP-generated alt text with manual review
- create-or-update synchronization into category-specific Payload collections

## How it works

```text
Google Maps source + editor input
                 |
                 v
       React forms / Query cache
                 |
                 v
          Hono API + Zod
                 |
        +--------+---------+
        |                  |
        v                  v
 geocode + taxonomy   media processing
        |             crop + alt text
        +--------+---------+
                 |
                 v
        normalized SQLite records
                 |
                 v
      review + tracked Payload sync
                 |
                 v
     CMS entries, media sets, assets
```

The sync layer resolves a stable Payload location reference from the local hierarchy. It stores the remote document ID after the first publish, so later runs update the original record instead of creating duplicates. Media sets use stable external references; an existing set can be reused during resync instead of uploading every variant again. Local update and sync timestamps also make stale records visible in the admin dashboard.

## Engineering decisions

**Make workflow state explicit.** Taxonomy entries move through pending and approved states, while CMS synchronization records pending, success, and failure. Editors can see what needs attention instead of inferring state from missing data.

**Normalize persistence around real ownership.** Locations, Instagram embeds, uploads, taxonomy, corrections, and sync state have separate SQLite tables and repositories. Foreign keys preserve parent-child relationships, and migration scripts carry the schema forward as the workflow evolves.

**Treat external systems as boundaries.** Google Maps, Instagram, the alt-text service, and Payload sit behind focused clients and services. This keeps transport details out of controllers and makes partial failure manageable.

**Design resync as reconciliation.** Stored remote IDs distinguish create from update. Stable media-set references prevent repeat uploads, and failures are recorded per location rather than hidden inside a bulk job.

**Keep media work recoverable.** Image variants are processed independently. One failed variant or Instagram asset does not discard every successful result, and the optional AI service does not become the source of truth for editorial text.

## What this demonstrates

Location Manager shows how I approach an operations-heavy product: model the workflow before polishing the screen, isolate integrations, preserve traceability, and give human review a clear place in automated pipelines. It combines frontend product work, backend architecture, data modeling, image processing, AI-assisted tooling, and CMS integration in one system I can evolve without collapsing those concerns together.
