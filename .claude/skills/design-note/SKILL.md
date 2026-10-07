---
name: design-note
description: Write a short high-level and low-level design for an MK Max change before coding it. Use for features or refactors that touch more than one layer, change the save format, change the planner, or add a data source. Skip for copy, styling and single-file fixes.
---

# Design note

A design note is a plan in the conversation, not a file in the repo. Keep it to what this change needs; most sections are a line or two. Read `docs/architecture.md` first.

## High level

- **Problem.** What the user sees or can't do today, in their words.
- **Approach.** The change in two or three sentences, and which layers it touches: views, store (`store.tsx`, `syncLoop.ts`), engine, normalize, external data (`events.ts`, `catalog.ts`, `wiki.ts`, `sync.ts`), build scripts, CI.
- **Alternatives.** One or two you considered and why not. Prefer the option with less new state.
- **Game rules.** Which rules in `AGENTS.md` this relies on or bends. If it needs a fact about the game that isn't written down, ask the user; don't guess.

## Low level

- **Data.** New or changed fields in `types.ts`. Synced (in `AppState`) or per-device (own localStorage key)? Migration needed? If so, follow the `save-migration` skill.
- **Engine.** New or changed functions, their inputs and outputs, and how `now` gets in. Note any effect on `buildPlan` order or scores.
- **UI.** Which view, where on screen, and the undo label for any destructive action.
- **Tests.** The cases that would catch a regression, mostly in `engine.test.ts` or `normalize`-based tests.
- **Docs.** Which `docs/` files change.

## After agreement

Implement, run `npm run lint`, `npm test` and `npm run build`, update the docs, and update `docs/architecture.md` if the structure changed.
