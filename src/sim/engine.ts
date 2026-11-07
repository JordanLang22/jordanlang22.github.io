import { createRng } from './rng';

export type NodeKind = 'source' | 'outbox' | 'relay' | 'agency';

export interface SimNode {
  readonly id: string;
  readonly kind: NodeKind;
  up: boolean;
}

/** A fact produced by a source. It belongs to one incident and has a place in that incident. */
export interface SimEvent {
  readonly id: number;
  readonly incident: number;
  readonly seq: number;
  readonly source: string;
  readonly agency: string;
}

export type PacketKind = 'commit' | 'commit-ack' | 'publish' | 'forward' | 'ack' | 'ack-relay';

export interface Packet {
  readonly event: SimEvent;
  readonly kind: PacketKind;
  readonly from: string;
  readonly to: string;
  readonly departed: number;
  readonly arrives: number;
  /** True when this packet is a retry of something already sent. */
  readonly retry: boolean;
  /** The relay carrying this event, so the ack can come back the same way. */
  readonly relay?: string;
}

export interface SimStats {
  emitted: number;
  applied: number;
  retried: number;
  deduplicated: number;
  dropped: number;
}

export type SimSignal =
  | { type: 'dropped'; node: string }
  | { type: 'applied'; node: string; event: SimEvent }
  | { type: 'deduplicated'; node: string };

export interface SimConfig {
  readonly seed: number;
  /** Probability that an up source emits on a given tick. */
  readonly emitRate: number;
  /** Lower and upper bound of a single hop, in ticks. */
  readonly latency: readonly [number, number];
  /** First retry delay in ticks. Must exceed a round trip or every event is sent twice. */
  readonly retryBase: number;
  readonly retryCap: number;
  /** How many due outbox rows are published per tick. */
  readonly publishRate: number;
}

export const DEFAULT_CONFIG: SimConfig = {
  seed: 2016,
  emitRate: 0.085,
  latency: [16, 24],
  retryBase: 110,
  retryCap: 420,
  publishRate: 3,
};

export const TOPOLOGY: readonly (Pick<SimNode, 'id' | 'kind'> & { label: string })[] = [
  { id: 'cad', kind: 'source', label: 'CAD' },
  { id: 'phones', kind: 'source', label: 'Phones' },
  { id: 'radio', kind: 'source', label: 'Radio' },
  { id: 'outbox', kind: 'outbox', label: 'Outbox' },
  { id: 'relay-a', kind: 'relay', label: 'Relay A' },
  { id: 'relay-b', kind: 'relay', label: 'Relay B' },
  { id: 'agency-1', kind: 'agency', label: 'Agency 1' },
  { id: 'agency-2', kind: 'agency', label: 'Agency 2' },
  { id: 'agency-3', kind: 'agency', label: 'Agency 3' },
];

interface Attempt {
  readonly event: SimEvent;
  nextAttempt: number;
  attempts: number;
}

interface Incident {
  readonly id: number;
  readonly agency: string;
  nextSeq: number;
  remaining: number;
}

interface IncidentLedger {
  next: number;
  readonly buffered: Map<number, SimEvent>;
}

const OPEN_INCIDENTS_PER_SOURCE = 2;
const OUTBOX = 'outbox';

/**
 * A deterministic model of a transactional outbox.
 *
 * Delivery is at-least-once: nothing is removed from the outbox until the receiving agency has
 * acknowledged it, and any hop can lose a packet. Agencies turn that into exactly-once effects by
 * remembering a per-incident watermark, and hold early arrivals so incidents apply in order.
 * Everything is driven by `step()`, so a run depends only on its seed and fault schedule.
 */
export class Simulation {
  readonly nodes: ReadonlyMap<string, SimNode>;
  readonly stats: SimStats = { emitted: 0, applied: 0, retried: 0, deduplicated: 0, dropped: 0 };
  packets: Packet[] = [];
  tick = 0;
  /** When false, sources stop producing new events and the system drains what it already has. */
  emitting = true;
  onApply?: (agency: string, event: SimEvent) => void;

  private readonly config: SimConfig;
  private readonly random: () => number;
  private readonly nodeList: readonly SimNode[];
  private readonly relays: readonly SimNode[];
  private readonly agencies: readonly SimNode[];
  private readonly sources: readonly SimNode[];
  private readonly incidents = new Map<string, Incident[]>();
  private readonly sourcePending = new Map<string, Map<number, Attempt>>();
  private readonly outboxRows = new Map<number, Attempt>();
  private readonly ledgers = new Map<string, Map<number, IncidentLedger>>();
  private readonly unapplied = new Set<number>();
  private signals: SimSignal[] = [];
  private nextEventId = 1;
  private nextIncidentId = 1;

  constructor(config: Partial<SimConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.random = createRng(this.config.seed);
    this.nodeList = TOPOLOGY.map(({ id, kind }) => ({ id, kind, up: true }));
    this.nodes = new Map(this.nodeList.map((node) => [node.id, node]));
    this.relays = this.nodeList.filter((node) => node.kind === 'relay');
    this.agencies = this.nodeList.filter((node) => node.kind === 'agency');
    this.sources = this.nodeList.filter((node) => node.kind === 'source');
    for (const source of this.sources) {
      this.incidents.set(source.id, []);
      this.sourcePending.set(source.id, new Map());
    }
    for (const agency of this.agencies) this.ledgers.set(agency.id, new Map());
  }

  setUp(id: string, up: boolean): void {
    const node = this.nodes.get(id);
    if (node) node.up = up;
  }

  /** Advance one tick and return what happened during it. */
  step(): readonly SimSignal[] {
    this.tick += 1;
    this.signals = [];
    this.deliverArrivals();
    if (this.emitting) this.emit();
    this.retrySources();
    this.publishFromOutbox();
    return this.signals;
  }

  /** Events currently waiting to be applied anywhere in the system. */
  get backlog(): number {
    return this.unapplied.size;
  }

  get outboxDepth(): number {
    return this.outboxRows.size;
  }

  get quiescent(): boolean {
    return (
      this.unapplied.size === 0 &&
      this.outboxRows.size === 0 &&
      this.packets.length === 0 &&
      this.heldAtAgencies === 0
    );
  }

  /** Early arrivals parked at agencies. Stale duplicates must never accumulate here. */
  get heldAtAgencies(): number {
    let held = 0;
    for (const ledger of this.ledgers.values()) {
      for (const incident of ledger.values()) held += incident.buffered.size;
    }
    return held;
  }

  /**
   * Count events that were emitted, are not applied, and are not held anywhere that could still
   * deliver them. Computed from real state, not assumed, so the number on the page can be wrong.
   */
  lost(): number {
    let lost = 0;
    for (const id of this.unapplied) {
      if (!this.isHeld(id)) lost += 1;
    }
    return lost;
  }

  private isHeld(id: number): boolean {
    if (this.outboxRows.has(id)) return true;
    for (const pending of this.sourcePending.values()) {
      if (pending.has(id)) return true;
    }
    for (const ledger of this.ledgers.values()) {
      for (const incident of ledger.values()) {
        for (const event of incident.buffered.values()) {
          if (event.id === id) return true;
        }
      }
    }
    return false;
  }

  private deliverArrivals(): void {
    const inFlight: Packet[] = [];
    const arrived: Packet[] = [];
    for (const packet of this.packets) {
      (packet.arrives <= this.tick ? arrived : inFlight).push(packet);
    }
    this.packets = inFlight;
    for (const packet of arrived) {
      if (this.nodes.get(packet.to)?.up) {
        this.receive(packet);
      } else {
        this.stats.dropped += 1;
        this.signals.push({ type: 'dropped', node: packet.to });
      }
    }
  }

  private receive(packet: Packet): void {
    const { event, kind, to, relay } = packet;
    switch (kind) {
      case 'commit':
        if (!this.outboxRows.has(event.id) && this.unapplied.has(event.id)) {
          this.outboxRows.set(event.id, { event, nextAttempt: this.tick, attempts: 0 });
        }
        this.send(event, 'commit-ack', to, event.source);
        break;
      case 'commit-ack':
        this.sourcePending.get(event.source)?.delete(event.id);
        break;
      case 'publish':
        this.send(event, 'forward', to, event.agency, { relay: to, retry: packet.retry });
        break;
      case 'forward':
        this.applyAtAgency(to, event);
        if (relay) this.send(event, 'ack-relay', to, relay);
        break;
      case 'ack-relay':
        this.send(event, 'ack', to, OUTBOX);
        break;
      case 'ack':
        this.outboxRows.delete(event.id);
        break;
    }
  }

  private applyAtAgency(agency: string, event: SimEvent): void {
    const ledger = this.ledgers.get(agency);
    if (!ledger) return;
    let incident = ledger.get(event.incident);
    if (!incident) {
      incident = { next: 1, buffered: new Map() };
      ledger.set(event.incident, incident);
    }
    if (event.seq < incident.next || incident.buffered.has(event.seq)) {
      this.stats.deduplicated += 1;
      this.signals.push({ type: 'deduplicated', node: agency });
      return;
    }
    incident.buffered.set(event.seq, event);
    for (
      let ready = incident.buffered.get(incident.next);
      ready;
      ready = incident.buffered.get(incident.next)
    ) {
      incident.buffered.delete(incident.next);
      incident.next += 1;
      this.unapplied.delete(ready.id);
      this.stats.applied += 1;
      this.signals.push({ type: 'applied', node: agency, event: ready });
      this.onApply?.(agency, ready);
    }
  }

  private emit(): void {
    for (const source of this.sources) {
      if (!source.up || this.random() > this.config.emitRate) continue;
      const event = this.nextEvent(source.id);
      this.unapplied.add(event.id);
      this.stats.emitted += 1;
      this.sourcePending.get(source.id)?.set(event.id, {
        event,
        nextAttempt: this.tick + this.delay(0),
        attempts: 0,
      });
      this.send(event, 'commit', source.id, OUTBOX);
    }
  }

  private nextEvent(source: string): SimEvent {
    const open = this.incidents.get(source) ?? [];
    while (open.length < OPEN_INCIDENTS_PER_SOURCE) {
      const agency = this.pick(this.agencies);
      open.push({
        id: this.nextIncidentId++,
        agency: agency.id,
        nextSeq: 1,
        remaining: 3 + Math.floor(this.random() * 6),
      });
    }
    const index = Math.floor(this.random() * open.length);
    const incident = open[index] as Incident;
    const event: SimEvent = {
      id: this.nextEventId++,
      incident: incident.id,
      seq: incident.nextSeq++,
      source,
      agency: incident.agency,
    };
    incident.remaining -= 1;
    if (incident.remaining <= 0) open.splice(index, 1);
    return event;
  }

  private retrySources(): void {
    for (const source of this.sources) {
      if (!source.up) continue;
      for (const pending of this.sourcePending.get(source.id)?.values() ?? []) {
        if (pending.nextAttempt > this.tick) continue;
        pending.attempts += 1;
        pending.nextAttempt = this.tick + this.delay(pending.attempts);
        this.stats.retried += 1;
        this.send(pending.event, 'commit', source.id, OUTBOX, { retry: true });
      }
    }
  }

  private publishFromOutbox(): void {
    if (!this.nodes.get(OUTBOX)?.up) return;
    const relays = this.relays.filter((relay) => relay.up);
    if (relays.length === 0) return;
    let budget = this.config.publishRate;
    for (const row of this.outboxRows.values()) {
      if (budget === 0) return;
      if (row.nextAttempt > this.tick) continue;
      const retry = row.attempts > 0;
      if (retry) this.stats.retried += 1;
      row.attempts += 1;
      row.nextAttempt = this.tick + this.delay(row.attempts);
      this.send(row.event, 'publish', OUTBOX, this.pick(relays).id, { retry });
      budget -= 1;
    }
  }

  private send(
    event: SimEvent,
    kind: PacketKind,
    from: string,
    to: string,
    options: { retry?: boolean; relay?: string } = {},
  ): void {
    const [low, high] = this.config.latency;
    this.packets.push({
      event,
      kind,
      from,
      to,
      departed: this.tick,
      arrives: this.tick + low + Math.floor(this.random() * (high - low + 1)),
      retry: options.retry ?? false,
      ...(options.relay ? { relay: options.relay } : {}),
    });
  }

  /** Exponential backoff with jitter, so a recovering node is not hit by one synchronized wave. */
  private delay(attempts: number): number {
    const { retryBase, retryCap } = this.config;
    const backoff = Math.min(retryBase * 2 ** attempts, retryCap);
    return Math.round(backoff * (0.8 + this.random() * 0.4));
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length)] as T;
  }
}
