import { describe, expect, it } from 'vitest';
import { Audit } from './audit';
import type { Delivery, Envelope } from './engine';

const envelope = (overrides: Partial<Envelope> = {}): Envelope => ({
  id: 1,
  thread: 1,
  seq: 1,
  from: 'source-a',
  origin: 'source-a',
  direction: 'inbound',
  ...overrides,
});

const delivery = (id: number, seq: number, overrides: Partial<Delivery> = {}): Delivery => ({
  id,
  envelope: envelope(),
  target: 'product-a',
  seq,
  ...overrides,
});

// An auditor that cannot fail proves nothing, so each promise is broken here on purpose.
describe('the audit can be wrong', () => {
  it('stays clean for a stream applied once and in order', () => {
    const audit = new Audit();
    for (const [id, seq] of [
      [1, 1],
      [2, 2],
      [3, 3],
    ] as const)
      audit.record(delivery(id, seq));
    expect(audit.clean).toBe(true);
    expect(audit.report.applied).toBe(3);
  });

  it('catches a delivery applied twice', () => {
    const audit = new Audit();
    audit.record(delivery(1, 1));
    audit.record(delivery(1, 1));
    expect(audit.report).toMatchObject({ appliedTwice: 1, outOfOrder: 0, misrouted: 0 });
  });

  it('catches a delivery applied ahead of an earlier one', () => {
    const audit = new Audit();
    audit.record(delivery(2, 2));
    audit.record(delivery(1, 1));
    expect(audit.report.outOfOrder).toBe(2);
    expect(audit.report.appliedTwice).toBe(0);
  });

  it('catches a skipped delivery', () => {
    const audit = new Audit();
    audit.record(delivery(1, 1));
    audit.record(delivery(3, 3));
    expect(audit.report.outOfOrder).toBe(1);
  });

  it('keeps streams apart, so order is judged per thread and per target', () => {
    const audit = new Audit();
    audit.record(delivery(1, 1));
    audit.record(delivery(2, 1, { target: 'product-b' }));
    audit.record(delivery(3, 1, { envelope: envelope({ id: 2, thread: 2 }) }));
    expect(audit.clean).toBe(true);
  });

  it('catches an answer sent to a system that did not open the thread', () => {
    const audit = new Audit();
    const answer = envelope({ from: 'product-a', origin: 'source-a', direction: 'return' });
    audit.record(delivery(1, 1, { envelope: answer, target: 'source-b' }));
    expect(audit.report.misrouted).toBe(1);
    audit.record(delivery(2, 1, { envelope: answer, target: 'source-a' }));
    expect(audit.report.misrouted).toBe(1);
  });
});
