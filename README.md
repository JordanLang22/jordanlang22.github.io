# jordanlang22.github.io

My portfolio. The headline claims that software can keep its word, so the page has to demonstrate it.

## The simulation is real

The system at the top of the page isn't an animation. [`src/sim/engine.ts`](src/sim/engine.ts) is a
deterministic model of a two-way integration hub. Agency systems send messages in. The hub stores
them, translates them for each product with routing switched on, and carries any answers back to
the agency system that opened the incident. Any hop can lose any packet. The canvas only draws this
state, and the Lost counter is computed from that state rather than hard-coded to zero.

[`src/sim/engine.test.ts`](src/sim/engine.test.ts) uses fast-check to throw hundreds of random
schedules of failures and routing changes at it on every push, and asserts that:

1. No message is ever lost, in either direction, at any tick.
2. Every delivery is applied exactly once.
3. Every stream is applied in order.
4. Every answer returns to the system that opened the incident.

## The numbers measure themselves

Commits, pull requests, and lines of code aren't typed in.
[`scripts/snapshot-github.mjs`](scripts/snapshot-github.mjs) measures them across my repositories
every day, and the site rebuilds with the result. It counts the commits inside squash-merged pull
requests, refuses a result that looks like lost access, and keeps repository names out of its output
and its public logs. If a refresh fails, the site keeps its last good numbers.

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
