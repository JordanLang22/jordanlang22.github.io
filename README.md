# jordanlang22.github.io

My portfolio. The headline claims that software can keep its word, so the page has to demonstrate it.

## The simulation is real

The system at the top of the page isn't an animation. [`src/sim/engine.ts`](src/sim/engine.ts) is a
deterministic model of a two-way integration hub. It is generic on purpose: it models the pattern,
not any system I run for an employer. Source systems send messages in. The hub stores them,
translates them for each product with routing switched on, and carries any answers back to the
source that opened the thread.

The page dares you to lose a message. You can take any node down, switch a product off, drop
packets on every link, deliver them twice, shuffle their order, crash the store, or kill everything
at once. Four numbers have to stay at zero: lost, applied twice, out of order, and misrouted. None
of them is hard-coded. Lost is computed from what the system still holds, and the other three come
from [`src/sim/audit.ts`](src/sim/audit.ts), an auditor that shares no state with the simulation
and only watches what targets apply. [`src/sim/audit.test.ts`](src/sim/audit.test.ts) breaks each
promise on purpose to show the auditor can fail.

[`src/sim/engine.test.ts`](src/sim/engine.test.ts) uses fast-check to throw hundreds of random
schedules at it on every push: outages, routing changes, crashes, and link conditions far worse than
the page allows, up to 60% loss per hop with every packet doubled. It asserts that:

1. No message is ever lost, in either direction, at any tick.
2. Every delivery is applied exactly once.
3. Every stream is applied in order.
4. Every answer returns to the system that opened the thread.
5. The auditor on the page agrees with all of the above.

Add `?seed=` and a number to the address to replay the same traffic.

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
