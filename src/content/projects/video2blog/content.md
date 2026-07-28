---
title: Video2Blog
description: "An auditable AI editorial pipeline that turns YouTube transcripts into structured drafts with classification, quality gates, and human review."
kicker: "AI editorial pipeline"
role: "Founding Engineer"
status: "Active internal tool"
year: "2026–present"
order: 4
date: 2026-07-27
repository: "https://github.com/Questurian/video2blog"
stack:
  - Python
  - FastAPI
  - LangGraph
  - Vertex AI
  - React
  - SQLite
accent: "#6D91C9"
---

## Context

A useful video transcript is not yet an article. It contains spoken-language repetition, sponsorships, intros, missing context, and a structure optimized for watching rather than reading. A single large prompt can rewrite that material, but it is difficult to inspect, recover, or trust when part of the result fails.

Video2Blog began as a focused full-stack tool for this conversion problem. I worked on its evolution into Questurian's broader AI Blog Writer, where YouTube remains a dedicated pipeline alongside URL, prompt, itinerary, image, and location workflows.

## What I built

- YouTube URL and batch intake that captures source metadata and transcripts before generation begins.
- A FastAPI pipeline that cleans transcripts, classifies article type, retrieves format-specific editorial guidance, composes the draft, evaluates it, and generates a title.
- LangGraph orchestration with explicit branches for repair, retry, optional augmentation, SEO rollback, and finalization.
- Run-scoped persistence for status, stage outputs, artifacts, and diagnostics, keyed by a server-generated `run_id`.
- A React operator interface for starting runs, polling progress, inspecting intermediate stages, editing drafts, and explicitly syncing approved content into Payload CMS.
- Markdown and structured artifacts, plus conversion into Payload-compatible Lexical content for editorial round trips.

## How it works

```text
YouTube URL
    │
    v
transcript intake ─> cleanup gate ─> article classification
                                         │
                                         v
                            guidelines + coverage analysis
                                         │
                                         v
                                  compose draft
                                         │
                           fail ┌─────────┴─────────┐ pass
                                v                   v
                         targeted repair      SEO + optional
                                └────────────> augmentation
                                                    │
                                                    v
                                             title + artifact
                                                    │
                                                    v
                                      human edit ─> explicit CMS sync
```

Each run records its current state and stage results. The frontend polls a small status endpoint while work continues, then hydrates the finished draft and exposes diagnostics when an operator needs to understand a decision. Re-running a stage replaces that run's stage result instead of creating ambiguous duplicates.

## Engineering decisions

**Make the pipeline inspectable.** Cleanup, classification, composition, SEO, augmentation, and title generation are visible phases with persisted outputs. A failure has a location and a recoverable input, rather than only a final malformed article.

**Use gates as control flow.** Coverage and quality checks do more than score prose: they decide whether the graph proceeds, retries, repairs a targeted issue, or rolls back an unsafe enrichment. Deterministic policy is kept separate from provider calls and graph wiring.

**Keep model output behind human intent.** Article type, tone, and other editorial choices are operator inputs. Finished content becomes a local `Draft`; sync to the CMS remains an explicit action, preserving a review boundary between generation and publication.

**Persist contracts, not framework internals.** Pydantic models define stage and API payloads, while a run recorder owns lifecycle writes. This allows orchestration code to change without silently changing the frontend contract or stored artifact shape.

**Evolve the prototype without discarding it.** The standalone repository established the four-stage product and its React/FastAPI workflow. The integrated monorepo expands that foundation with shared model utilities, LangGraph routing, richer quality policy, Lexical conversion, and CMS sync.

## What this demonstrates

Video2Blog demonstrates end-to-end AI product engineering: source ingestion, prompt and model orchestration, typed APIs, long-running task UX, persistence, diagnostics, quality control, and editorial integration. It also shows how I move an AI prototype toward an operable internal product where people can see, correct, and approve what the system produced.
