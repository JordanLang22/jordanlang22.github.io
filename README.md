# jordanlang22.github.io

My portfolio. The headline claims that software can keep its word, so the page has to demonstrate it.

## The simulation is real

The system at the top of the page isn't an animation. [`src/sim/engine.ts`](src/sim/engine.ts) is a
deterministic model of a transactional outbox: at-least-once delivery, lost packets, exponential
backoff with jitter, idempotent consumers, and per-incident ordering. The canvas only draws its
state, and the Lost counter is computed from that state rather than hard-coded to zero.

[`src/sim/engine.test.ts`](src/sim/engine.test.ts) uses fast-check to throw hundreds of random
failure schedules at it on every push and asserts three invariants:

1. No event is ever lost, at any tick.
2. Every event is applied exactly once.
3. Every incident is applied in order.

## Redaction is structural

Most of my work is private, so the case files use redaction bars. A sealed bar is generated from a
width and a reason, so the private text never exists in the source or the page. See
[`src/lib/redaction.ts`](src/lib/redaction.ts).

[`scripts/guard-public.mjs`](scripts/guard-public.mjs) fails CI if a private term appears in this
repository or the build. It stores hashes, because a plain list would publish what it protects.

## Built to degrade well

No framework runtime. With JavaScript off, all of the writing still reads. With reduced motion, the
simulation waits for you to press Run.

## Stack

Astro, TypeScript, Canvas 2D, GSAP, Vitest, fast-check, Playwright, axe, and Biome. Deployed to
GitHub Pages only after everything above passes.

```bash
npm ci
npm run dev
npm test
```

Built with Claude Code as a pair. The commits say so.
