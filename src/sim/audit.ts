import type { Delivery } from './engine';

export interface AuditReport {
  /** Every effect a target has been asked to apply. */
  applied: number;
  /** The same delivery applied more than once. */
  appliedTwice: number;
  /** A delivery applied before an earlier one in its stream. */
  outOfOrder: number;
  /** An answer applied anywhere other than the system that opened its thread. */
  misrouted: number;
}

/**
 * Watches what targets actually apply and keeps score. It shares no state with the simulation and
 * knows nothing about watermarks or retries, only the promises: once, in order, to the right place.
 * The numbers on the page come from here, so they are able to be wrong.
 */
export class Audit {
  readonly report: AuditReport = { applied: 0, appliedTwice: 0, outOfOrder: 0, misrouted: 0 };
  private readonly seen = new Set<number>();
  private readonly next = new Map<string, number>();

  record({ id, envelope, target, seq }: Delivery): void {
    const { report } = this;
    report.applied += 1;
    if (envelope.direction === 'return' && target !== envelope.origin) report.misrouted += 1;
    if (this.seen.has(id)) {
      report.appliedTwice += 1;
      return;
    }
    this.seen.add(id);
    const stream = `${envelope.thread}>${target}`;
    const expected = this.next.get(stream) ?? 1;
    if (seq !== expected) report.outOfOrder += 1;
    this.next.set(stream, Math.max(expected, seq + 1));
  }

  get clean(): boolean {
    const { appliedTwice, outOfOrder, misrouted } = this.report;
    return appliedTwice + outOfOrder + misrouted === 0;
  }
}
