import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type SimEvent, Simulation, TOPOLOGY } from './engine';

interface Fault {
  tick: number;
  node: string;
  up: boolean;
}

const ACTIVE_TICKS = 2_500;
const DRAIN_LIMIT = 60_000;

const faultArbitrary: fc.Arbitrary<Fault> = fc.record({
  tick: fc.integer({ min: 0, max: ACTIVE_TICKS }),
  node: fc.constantFrom(...TOPOLOGY.map((node) => node.id)),
  up: fc.boolean(),
});

/** Run a fault schedule, heal everything, and drain. Returns the agencies' complete apply log. */
function run(seed: number, faults: readonly Fault[]) {
  const sim = new Simulation({ seed });
  const applied: SimEvent[] = [];
  let peakLost = 0;
  sim.onApply = (_agency, event) => applied.push(event);

  const byTick = new Map<number, Fault[]>();
  for (const fault of faults) {
    byTick.set(fault.tick, [...(byTick.get(fault.tick) ?? []), fault]);
  }
  for (let tick = 0; tick < ACTIVE_TICKS; tick += 1) {
    for (const fault of byTick.get(tick) ?? []) sim.setUp(fault.node, fault.up);
    sim.step();
    peakLost = Math.max(peakLost, sim.lost());
  }

  for (const node of TOPOLOGY) sim.setUp(node.id, true);
  sim.emitting = false;
  let drainTicks = 0;
  while (!sim.quiescent && drainTicks < DRAIN_LIMIT) {
    sim.step();
    peakLost = Math.max(peakLost, sim.lost());
    drainTicks += 1;
  }
  return { sim, applied, peakLost, drainTicks };
}

describe('delivery invariants under arbitrary failure', () => {
  const schedules = fc.record({
    seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
    faults: fc.array(faultArbitrary, { maxLength: 40 }),
  });

  it('never loses an event, at any tick', () => {
    fc.assert(
      fc.property(schedules, ({ seed, faults }) => {
        const { sim, peakLost } = run(seed, faults);
        expect(peakLost).toBe(0);
        expect(sim.quiescent).toBe(true);
        expect(sim.stats.applied).toBe(sim.stats.emitted);
      }),
      { numRuns: 200 },
    );
  });

  it('applies every event exactly once', () => {
    fc.assert(
      fc.property(schedules, ({ seed, faults }) => {
        const { sim, applied } = run(seed, faults);
        const ids = applied.map((event) => event.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBe(sim.stats.emitted);
      }),
      { numRuns: 200 },
    );
  });

  it('applies each incident in order, at the right agency', () => {
    fc.assert(
      fc.property(schedules, ({ seed, faults }) => {
        const { applied } = run(seed, faults);
        const next = new Map<number, number>();
        for (const event of applied) {
          expect(event.seq).toBe(next.get(event.incident) ?? 1);
          next.set(event.incident, event.seq + 1);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('simulation behaviour', () => {
  it('is deterministic for a seed and fault schedule', () => {
    const faults = [
      { tick: 200, node: 'relay-a', up: false },
      { tick: 900, node: 'relay-a', up: true },
    ];
    const first = run(7, faults);
    const second = run(7, faults);
    expect(second.sim.stats).toEqual(first.sim.stats);
    expect(second.applied).toEqual(first.applied);
  });

  it('holds work while every relay is down, then delivers it', () => {
    const sim = new Simulation({ seed: 3 });
    sim.setUp('relay-a', false);
    sim.setUp('relay-b', false);
    for (let tick = 0; tick < 1_000; tick += 1) sim.step();
    expect(sim.stats.applied).toBe(0);
    expect(sim.outboxDepth).toBeGreaterThan(0);
    expect(sim.lost()).toBe(0);

    sim.setUp('relay-a', true);
    sim.setUp('relay-b', true);
    sim.emitting = false;
    for (let tick = 0; tick < 20_000 && !sim.quiescent; tick += 1) sim.step();
    expect(sim.stats.applied).toBe(sim.stats.emitted);
  });

  it('creates real duplicates when an ack is lost, and absorbs them', () => {
    const sim = new Simulation({ seed: 11 });
    for (let tick = 0; tick < 3_000; tick += 1) {
      sim.setUp('outbox', tick % 400 > 300);
      sim.step();
    }
    sim.setUp('outbox', true);
    sim.emitting = false;
    for (let tick = 0; tick < 20_000 && !sim.quiescent; tick += 1) sim.step();
    expect(sim.stats.deduplicated).toBeGreaterThan(0);
    expect(sim.stats.applied).toBe(sim.stats.emitted);
  });

  it('keeps retries rare on a healthy system', () => {
    const sim = new Simulation({ seed: 5 });
    for (let tick = 0; tick < 5_000; tick += 1) sim.step();
    expect(sim.stats.retried / sim.stats.emitted).toBeLessThan(0.02);
  });
});
