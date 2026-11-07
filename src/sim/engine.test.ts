import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Delivery, type Envelope, Simulation, TOPOLOGY } from './engine';

type Fault =
  | { type: 'node'; tick: number; node: string; up: boolean }
  | { type: 'routing'; tick: number; product: string; on: boolean };

const ACTIVE_TICKS = 2_500;
const DRAIN_LIMIT = 60_000;
const PRODUCTS = TOPOLOGY.filter((node) => node.kind === 'product').map((node) => node.id);

const faultArbitrary: fc.Arbitrary<Fault> = fc.oneof(
  fc.record({
    type: fc.constant('node' as const),
    tick: fc.integer({ min: 0, max: ACTIVE_TICKS }),
    node: fc.constantFrom(...TOPOLOGY.map((node) => node.id)),
    up: fc.boolean(),
  }),
  fc.record({
    type: fc.constant('routing' as const),
    tick: fc.integer({ min: 0, max: ACTIVE_TICKS }),
    product: fc.constantFrom(...PRODUCTS),
    on: fc.boolean(),
  }),
);

/** Run a schedule, heal everything, and drain. Returns the system's complete audit trail. */
function run(seed: number, faults: readonly Fault[]) {
  const sim = new Simulation({ seed });
  const applied: Delivery[] = [];
  const stored: { envelope: Envelope; targets: readonly string[] }[] = [];
  let peakLost = 0;
  sim.onApply = (delivery) => applied.push(delivery);
  sim.onStore = (envelope, targets) => stored.push({ envelope, targets });

  const byTick = new Map<number, Fault[]>();
  for (const fault of faults) {
    byTick.set(fault.tick, [...(byTick.get(fault.tick) ?? []), fault]);
  }
  for (let tick = 0; tick < ACTIVE_TICKS; tick += 1) {
    for (const fault of byTick.get(tick) ?? []) {
      if (fault.type === 'node') sim.setUp(fault.node, fault.up);
      else sim.setRouting(fault.product, fault.on);
    }
    sim.step();
    peakLost = Math.max(peakLost, sim.lost());
  }

  for (const node of TOPOLOGY) sim.setUp(node.id, true);
  sim.emitting = false;
  for (let tick = 0; tick < DRAIN_LIMIT && !sim.quiescent; tick += 1) {
    sim.step();
    peakLost = Math.max(peakLost, sim.lost());
  }
  return { sim, applied, stored, peakLost };
}

const schedules = fc.record({
  seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
  faults: fc.array(faultArbitrary, { maxLength: 40 }),
});

describe('delivery invariants under arbitrary failure', () => {
  it('never loses a message in either direction, at any tick', () => {
    fc.assert(
      fc.property(schedules, ({ seed, faults }) => {
        const { sim, peakLost } = run(seed, faults);
        expect(peakLost).toBe(0);
        expect(sim.quiescent).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('stores every message, and applies every delivery exactly once', () => {
    fc.assert(
      fc.property(schedules, ({ seed, faults }) => {
        const { applied, stored } = run(seed, faults);
        const owed = stored.flatMap(({ envelope, targets }) =>
          targets.map((target) => `${envelope.id}>${target}`),
        );
        const made = applied.map(({ envelope, target }) => `${envelope.id}>${target}`);
        expect(new Set(made).size).toBe(made.length);
        expect(new Set(made)).toEqual(new Set(owed));
      }),
      { numRuns: 150 },
    );
  });

  it('applies every stream in order, even after arriving out of order', () => {
    fc.assert(
      fc.property(schedules, ({ seed, faults }) => {
        const { applied } = run(seed, faults);
        const next = new Map<string, number>();
        for (const { envelope, target, seq } of applied) {
          const key = `${envelope.incident}>${target}`;
          expect(seq).toBe(next.get(key) ?? 1);
          next.set(key, seq + 1);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('returns every answer to the agency system that opened the incident', () => {
    fc.assert(
      fc.property(schedules, ({ seed, faults }) => {
        const { applied } = run(seed, faults);
        const answers = applied.filter(({ envelope }) => envelope.direction === 'return');
        for (const { envelope, target } of answers) expect(target).toBe(envelope.agency);
      }),
      { numRuns: 150 },
    );
  });
});

describe('routing', () => {
  it('sends nothing to a switched-off product, and keeps serving the others', () => {
    const sim = new Simulation({ seed: 9 });
    const received = new Set<string>();
    sim.onApply = ({ target }) => received.add(target);
    sim.setRouting('product-b', false);
    for (let tick = 0; tick < 3_000; tick += 1) sim.step();
    expect(received).toContain('product-a');
    expect(received).toContain('product-c');
    expect(received).not.toContain('product-b');
    expect(sim.lost()).toBe(0);
  });

  it('still returns answers while the product that sent them is switched off', () => {
    const sim = new Simulation({ seed: 21 });
    for (let tick = 0; tick < 600; tick += 1) sim.step();
    for (const product of PRODUCTS) sim.setRouting(product, false);
    const before = sim.stats.returned;
    sim.emitting = false;
    for (let tick = 0; tick < 20_000 && !sim.quiescent; tick += 1) sim.step();
    expect(sim.quiescent).toBe(true);
    expect(sim.stats.returned).toBeGreaterThan(before);
  });

  it('stores incoming messages even when every product is switched off', () => {
    const sim = new Simulation({ seed: 4 });
    for (const product of PRODUCTS) sim.setRouting(product, false);
    for (let tick = 0; tick < 1_500; tick += 1) sim.step();
    expect(sim.stats.stored).toBeGreaterThan(0);
    expect(sim.stats.delivered).toBe(0);
  });
});

describe('simulation behaviour', () => {
  it('is deterministic for a seed and schedule', () => {
    const faults: Fault[] = [
      { type: 'node', tick: 200, node: 'translate', up: false },
      { type: 'routing', tick: 400, product: 'product-a', on: false },
      { type: 'node', tick: 900, node: 'translate', up: true },
    ];
    const first = run(7, faults);
    const second = run(7, faults);
    expect(second.sim.stats).toEqual(first.sim.stats);
    expect(second.applied).toEqual(first.applied);
  });

  it('holds work while the store is down, then delivers it', () => {
    const sim = new Simulation({ seed: 3 });
    sim.setUp('store', false);
    for (let tick = 0; tick < 1_000; tick += 1) sim.step();
    expect(sim.stats.stored).toBe(0);
    expect(sim.stats.emitted).toBeGreaterThan(0);
    expect(sim.lost()).toBe(0);

    sim.setUp('store', true);
    sim.emitting = false;
    for (let tick = 0; tick < 20_000 && !sim.quiescent; tick += 1) sim.step();
    expect(sim.stats.stored).toBeGreaterThanOrEqual(sim.stats.emitted);
    expect(sim.quiescent).toBe(true);
  });

  it('creates real duplicates when an ack is lost, and absorbs them', () => {
    const sim = new Simulation({ seed: 11 });
    for (let tick = 0; tick < 3_000; tick += 1) {
      sim.setUp('translate', tick % 400 > 300);
      sim.step();
    }
    sim.setUp('translate', true);
    sim.emitting = false;
    for (let tick = 0; tick < 20_000 && !sim.quiescent; tick += 1) sim.step();
    expect(sim.stats.deduplicated).toBeGreaterThan(0);
    expect(sim.quiescent).toBe(true);
  });

  it('keeps retries rare on a healthy system', () => {
    const sim = new Simulation({ seed: 5 });
    for (let tick = 0; tick < 5_000; tick += 1) sim.step();
    expect(sim.stats.retried / sim.stats.emitted).toBeLessThan(0.02);
  });
});
