import { createRng } from './rng';

export type NodeKind = 'source' | 'ingest' | 'store' | 'translate' | 'product';
export type Direction = 'inbound' | 'return';

export interface SimNode {
  readonly id: string;
  readonly kind: NodeKind;
  up: boolean;
}

/** One message handed to the hub, by an source system or by a product answering it. */
export interface Envelope {
  readonly id: number;
  readonly thread: number;
  readonly seq: number;
  readonly from: string;
  /** The source system that opened this thread, which is where any answer has to go. */
  readonly origin: string;
  readonly direction: Direction;
}

/** One copy of a stored message, on its way to exactly one target. */
export interface Delivery {
  readonly id: number;
  readonly envelope: Envelope;
  readonly target: string;
  readonly seq: number;
}

export type PacketKind = 'submit' | 'submit-ack' | 'deliver' | 'deliver-ack';

export interface Packet {
  readonly kind: PacketKind;
  readonly direction: Direction;
  readonly route: readonly string[];
  readonly hop: number;
  readonly from: string;
  readonly to: string;
  readonly departed: number;
  readonly arrives: number;
  /** True when this packet is a retry of something already sent. */
  readonly retry: boolean;
  readonly envelope: Envelope;
  readonly delivery?: Delivery;
}

export interface SimStats {
  emitted: number;
  stored: number;
  delivered: number;
  returned: number;
  retried: number;
  deduplicated: number;
  dropped: number;
}

export type SimSignal =
  | { type: 'dropped'; node: string }
  | { type: 'stored'; node: string; envelope: Envelope; targets: readonly string[] }
  | { type: 'applied'; node: string; delivery: Delivery }
  | { type: 'deduplicated'; node: string };

export interface SimConfig {
  readonly seed: number;
  /** Probability that an up source system emits on a given tick. */
  readonly emitRate: number;
  /** Probability that a product answers a message it applied. */
  readonly replyRate: number;
  /** Lower and upper bound of a single hop, in ticks. */
  readonly latency: readonly [number, number];
  /** First retry delay in ticks. Must exceed a round trip or everything is sent twice. */
  readonly retryBase: number;
  readonly retryCap: number;
  /** How many due deliveries the store publishes per tick. */
  readonly publishRate: number;
}

/**
 * Hostile conditions on every link, on top of whatever nodes are down. All three are things real
 * networks do. None of them is allowed to cost a message.
 */
export interface Chaos {
  /** Probability that a packet vanishes on any single hop. */
  loss: number;
  /** Probability that a packet arrives twice at the end of a hop. */
  duplicate: number;
  /** Extra latency of up to this many ticks per hop, which shuffles arrival order. */
  jitter: number;
}

export const CALM: Readonly<Chaos> = { loss: 0, duplicate: 0, jitter: 0 };

export const DEFAULT_CONFIG: SimConfig = {
  seed: 2016,
  emitRate: 0.042,
  replyRate: 0.45,
  latency: [15, 22],
  retryBase: 110,
  retryCap: 420,
  publishRate: 4,
};

export const TOPOLOGY: readonly (Pick<SimNode, 'id' | 'kind'> & { label: string })[] = [
  { id: 'source-a', kind: 'source', label: 'Source A' },
  { id: 'source-b', kind: 'source', label: 'Source B' },
  { id: 'source-c', kind: 'source', label: 'Source C' },
  { id: 'ingest', kind: 'ingest', label: 'Ingest' },
  { id: 'store', kind: 'store', label: 'Store' },
  { id: 'translate', kind: 'translate', label: 'Translate' },
  { id: 'product-a', kind: 'product', label: 'Product A' },
  { id: 'product-b', kind: 'product', label: 'Product B' },
  { id: 'product-c', kind: 'product', label: 'Product C' },
];

interface Attempt<T> {
  readonly item: T;
  nextAttempt: number;
  attempts: number;
}

interface Stream<T> {
  next: number;
  readonly held: Map<number, T>;
}

interface Thread {
  readonly id: number;
  nextSeq: number;
  remaining: number;
}

const STORE = 'store';
const OPEN_THREADS_PER_SOURCE = 2;
const ACK_KINDS: Partial<Record<PacketKind, PacketKind>> = {
  submit: 'submit-ack',
  deliver: 'deliver-ack',
};

/**
 * A deterministic model of a two-way integration hub.
 *
 * Source systems submit messages to the hub, which stores them in order, fans each one out to the
 * products with routing switched on, and translates it for each. Products can answer, and the
 * answer travels the same way back to the source system that opened the thread.
 *
 * Both directions share one protocol. A sender keeps a message until the store has acknowledged
 * it, and the store keeps a delivery until its target has. Any hop can lose any packet, so delivery
 * is at-least-once. Receivers turn that into exactly-once effects with a per-stream watermark, and
 * hold early arrivals so that every stream applies in order. Everything is driven by `step()`, so a
 * run depends only on its seed and on the faults applied to it.
 */
export class Simulation {
  readonly nodes: ReadonlyMap<string, SimNode>;
  readonly routing = new Map<string, boolean>();
  readonly stats: SimStats = {
    emitted: 0,
    stored: 0,
    delivered: 0,
    returned: 0,
    retried: 0,
    deduplicated: 0,
    dropped: 0,
  };
  packets: Packet[] = [];
  tick = 0;
  /** When false, sources stop producing new threads and the system drains what it has. */
  emitting = true;
  onStore?: (envelope: Envelope, targets: readonly string[]) => void;
  onApply?: (delivery: Delivery) => void;

  private chaos: Chaos = { ...CALM };
  private readonly config: SimConfig;
  private readonly random: () => number;
  private readonly sources: readonly SimNode[];
  private readonly products: readonly SimNode[];
  private readonly threads = new Map<string, Thread[]>();
  private readonly pending = new Map<string, Map<number, Attempt<Envelope>>>();
  private readonly rows = new Map<number, Attempt<Delivery>>();
  private readonly inboundStreams = new Map<string, Stream<Envelope>>();
  private readonly targetStreams = new Map<string, Stream<Delivery>>();
  private readonly nextDeliverySeq = new Map<string, number>();
  private readonly nextReplySeq = new Map<string, number>();
  private readonly unreleased = new Set<number>();
  private readonly unapplied = new Set<number>();
  private signals: SimSignal[] = [];
  private nextEnvelopeId = 1;
  private nextDeliveryId = 1;
  private nextThreadId = 1;

  constructor(config: Partial<SimConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.random = createRng(this.config.seed);
    const nodes = TOPOLOGY.map(({ id, kind }): SimNode => ({ id, kind, up: true }));
    this.nodes = new Map(nodes.map((node) => [node.id, node]));
    this.sources = nodes.filter((node) => node.kind === 'source');
    this.products = nodes.filter((node) => node.kind === 'product');
    for (const source of this.sources) {
      this.threads.set(source.id, []);
      this.pending.set(source.id, new Map());
    }
    for (const product of this.products) {
      this.pending.set(product.id, new Map());
      this.routing.set(product.id, true);
    }
  }

  setUp(id: string, up: boolean): void {
    const node = this.nodes.get(id);
    if (node) node.up = up;
  }

  /** Choose whether new messages go to a product. This is a decision, not a failure. */
  setRouting(product: string, on: boolean): void {
    if (this.routing.has(product)) this.routing.set(product, on);
  }

  /** Change the weather on every link. Unnamed fields keep their current value. */
  setChaos(chaos: Partial<Chaos>): void {
    this.chaos = { ...this.chaos, ...chaos };
  }

  /**
   * Kill a node's process and start it again. Whatever was on the wire to or from it is gone, and
   * it comes back knowing only what it wrote down. So it re-sends everything it holds that was
   * never acknowledged, which is correct and also a flood of duplicates for someone else to absorb.
   */
  crash(id: string): void {
    if (!this.nodes.has(id)) return;
    const surviving: Packet[] = [];
    for (const packet of this.packets) {
      if (packet.from === id || packet.to === id) this.drop(id);
      else surviving.push(packet);
    }
    this.packets = surviving;
    if (id === STORE) for (const row of this.rows.values()) row.nextAttempt = this.tick;
    for (const attempt of this.pending.get(id)?.values() ?? []) attempt.nextAttempt = this.tick;
  }

  /** Advance one tick and return what happened during it. */
  step(): readonly SimSignal[] {
    this.tick += 1;
    this.signals = [];
    this.deliverArrivals();
    if (this.emitting) this.emit();
    this.retrySenders();
    this.publish();
    return this.signals;
  }

  get storeDepth(): number {
    return this.rows.size;
  }

  get quiescent(): boolean {
    let waiting = 0;
    for (const queue of this.pending.values()) waiting += queue.size;
    return (
      waiting === 0 &&
      this.unreleased.size === 0 &&
      this.unapplied.size === 0 &&
      this.rows.size === 0 &&
      this.packets.length === 0 &&
      this.heldByReceivers === 0
    );
  }

  /** Early arrivals parked at receivers. Stale duplicates must never accumulate here. */
  get heldByReceivers(): number {
    let held = 0;
    for (const stream of this.inboundStreams.values()) held += stream.held.size;
    for (const stream of this.targetStreams.values()) held += stream.held.size;
    return held;
  }

  /**
   * Count messages the system owes someone but no longer holds anywhere that could deliver them.
   * Computed from real state, not assumed, so the number on the page is able to be wrong.
   */
  lost(): number {
    const heldEnvelopes = new Set<number>();
    for (const queue of this.pending.values()) {
      for (const id of queue.keys()) heldEnvelopes.add(id);
    }
    for (const stream of this.inboundStreams.values()) {
      for (const envelope of stream.held.values()) heldEnvelopes.add(envelope.id);
    }
    const heldDeliveries = new Set<number>(this.rows.keys());
    for (const stream of this.targetStreams.values()) {
      for (const delivery of stream.held.values()) heldDeliveries.add(delivery.id);
    }
    let lost = 0;
    for (const id of this.unreleased) if (!heldEnvelopes.has(id)) lost += 1;
    for (const id of this.unapplied) if (!heldDeliveries.has(id)) lost += 1;
    return lost;
  }

  private deliverArrivals(): void {
    const inFlight: Packet[] = [];
    const arrived: Packet[] = [];
    for (const packet of this.packets) {
      (packet.arrives <= this.tick ? arrived : inFlight).push(packet);
    }
    this.packets = inFlight;
    const { loss, duplicate } = this.chaos;
    for (const packet of arrived) {
      // The generator is only consulted when a condition is switched on, so a calm run draws the
      // same numbers it always did.
      if (!this.nodes.get(packet.to)?.up || (loss > 0 && this.random() < loss)) {
        this.drop(packet.to);
        continue;
      }
      const copies = duplicate > 0 && this.random() < duplicate ? 2 : 1;
      for (let copy = 0; copy < copies; copy += 1) {
        if (packet.hop + 1 < packet.route.length - 1)
          this.launch({ ...packet, hop: packet.hop + 1 });
        else this.receive(packet);
      }
    }
  }

  private drop(node: string): void {
    this.stats.dropped += 1;
    this.signals.push({ type: 'dropped', node });
  }

  private receive(packet: Packet): void {
    const { kind, envelope, delivery } = packet;
    if (kind === 'submit') this.receiveAtStore(envelope);
    if (kind === 'deliver' && delivery) this.receiveAtTarget(delivery);
    if (kind === 'submit-ack') this.pending.get(envelope.from)?.delete(envelope.id);
    if (kind === 'deliver-ack' && delivery) this.rows.delete(delivery.id);
    const ack = ACK_KINDS[kind];
    if (ack) this.launch({ ...packet, kind: ack, route: [...packet.route].reverse(), hop: 0 });
  }

  private receiveAtStore(envelope: Envelope): void {
    const key = `${envelope.thread}:${envelope.from}`;
    this.accept(this.inboundStreams, key, envelope.seq, envelope, STORE, (ready) => {
      this.unreleased.delete(ready.id);
      this.stats.stored += 1;
      const targets = this.targetsFor(ready);
      for (const target of targets) this.createDelivery(ready, target);
      this.onStore?.(ready, targets);
      this.signals.push({ type: 'stored', node: STORE, envelope: ready, targets });
    });
  }

  private targetsFor(envelope: Envelope): readonly string[] {
    if (envelope.direction === 'return') return [envelope.origin];
    return this.products.filter(({ id }) => this.routing.get(id)).map(({ id }) => id);
  }

  private createDelivery(envelope: Envelope, target: string): void {
    const key = `${envelope.thread}>${target}`;
    const seq = (this.nextDeliverySeq.get(key) ?? 0) + 1;
    this.nextDeliverySeq.set(key, seq);
    const delivery: Delivery = { id: this.nextDeliveryId++, envelope, target, seq };
    this.unapplied.add(delivery.id);
    this.rows.set(delivery.id, { item: delivery, nextAttempt: this.tick, attempts: 0 });
  }

  private receiveAtTarget(delivery: Delivery): void {
    const key = `${delivery.envelope.thread}>${delivery.target}`;
    this.accept(this.targetStreams, key, delivery.seq, delivery, delivery.target, (ready) => {
      this.unapplied.delete(ready.id);
      const inbound = ready.envelope.direction === 'inbound';
      this.stats[inbound ? 'delivered' : 'returned'] += 1;
      this.signals.push({ type: 'applied', node: ready.target, delivery: ready });
      this.onApply?.(ready);
      if (inbound && this.random() < this.config.replyRate) this.answer(ready);
    });
  }

  /** The watermark and the hold-back buffer: at-least-once in, exactly-once and in order out. */
  private accept<T>(
    streams: Map<string, Stream<T>>,
    key: string,
    seq: number,
    item: T,
    node: string,
    release: (ready: T) => void,
  ): void {
    let stream = streams.get(key);
    if (!stream) {
      stream = { next: 1, held: new Map() };
      streams.set(key, stream);
    }
    if (seq < stream.next || stream.held.has(seq)) {
      this.stats.deduplicated += 1;
      this.signals.push({ type: 'deduplicated', node });
      return;
    }
    stream.held.set(seq, item);
    for (let ready = stream.held.get(stream.next); ready; ready = stream.held.get(stream.next)) {
      stream.held.delete(stream.next);
      stream.next += 1;
      release(ready);
    }
  }

  private answer(delivery: Delivery): void {
    const { target, envelope } = delivery;
    const key = `${envelope.thread}:${target}`;
    const seq = (this.nextReplySeq.get(key) ?? 0) + 1;
    this.nextReplySeq.set(key, seq);
    this.submit({
      id: this.nextEnvelopeId++,
      thread: envelope.thread,
      seq,
      from: target,
      origin: envelope.origin,
      direction: 'return',
    });
  }

  private emit(): void {
    for (const source of this.sources) {
      if (!source.up || this.random() > this.config.emitRate) continue;
      const open = this.threads.get(source.id) ?? [];
      while (open.length < OPEN_THREADS_PER_SOURCE) {
        open.push({
          id: this.nextThreadId++,
          nextSeq: 1,
          remaining: 3 + Math.floor(this.random() * 6),
        });
      }
      const index = Math.floor(this.random() * open.length);
      const thread = open[index] as Thread;
      this.stats.emitted += 1;
      this.submit({
        id: this.nextEnvelopeId++,
        thread: thread.id,
        seq: thread.nextSeq++,
        from: source.id,
        origin: source.id,
        direction: 'inbound',
      });
      thread.remaining -= 1;
      if (thread.remaining <= 0) open.splice(index, 1);
    }
  }

  private submit(envelope: Envelope): void {
    this.unreleased.add(envelope.id);
    this.pending.get(envelope.from)?.set(envelope.id, {
      item: envelope,
      nextAttempt: this.tick + this.delay(0),
      attempts: 0,
    });
    this.launchSubmit(envelope, false);
  }

  private launchSubmit(envelope: Envelope, retry: boolean): void {
    const via = envelope.direction === 'inbound' ? 'ingest' : 'translate';
    this.launch({
      kind: 'submit',
      direction: envelope.direction,
      route: [envelope.from, via, STORE],
      hop: 0,
      retry,
      envelope,
    });
  }

  private retrySenders(): void {
    for (const [sender, queue] of this.pending) {
      if (!this.nodes.get(sender)?.up) continue;
      for (const attempt of queue.values()) {
        if (attempt.nextAttempt > this.tick) continue;
        attempt.attempts += 1;
        attempt.nextAttempt = this.tick + this.delay(attempt.attempts);
        this.stats.retried += 1;
        this.launchSubmit(attempt.item, true);
      }
    }
  }

  private publish(): void {
    if (!this.nodes.get(STORE)?.up) return;
    let budget = this.config.publishRate;
    for (const row of this.rows.values()) {
      if (budget === 0) return;
      if (row.nextAttempt > this.tick) continue;
      const retry = row.attempts > 0;
      if (retry) this.stats.retried += 1;
      row.attempts += 1;
      row.nextAttempt = this.tick + this.delay(row.attempts);
      const delivery = row.item;
      const via = delivery.envelope.direction === 'inbound' ? 'translate' : 'ingest';
      this.launch({
        kind: 'deliver',
        direction: delivery.envelope.direction,
        route: [STORE, via, delivery.target],
        hop: 0,
        retry,
        envelope: delivery.envelope,
        delivery,
      });
      budget -= 1;
    }
  }

  private launch(packet: Omit<Packet, 'from' | 'to' | 'departed' | 'arrives'>): void {
    const [low, high] = this.config.latency;
    const { jitter } = this.chaos;
    const delay = jitter > 0 ? Math.floor(this.random() * (jitter + 1)) : 0;
    this.packets.push({
      ...packet,
      from: packet.route[packet.hop] as string,
      to: packet.route[packet.hop + 1] as string,
      departed: this.tick,
      arrives: this.tick + low + Math.floor(this.random() * (high - low + 1)) + delay,
    });
  }

  /** Exponential backoff with jitter, so a recovering node is not hit by one synchronized wave. */
  private delay(attempts: number): number {
    const { retryBase, retryCap } = this.config;
    const backoff = Math.min(retryBase * 2 ** attempts, retryCap);
    return Math.round(backoff * (0.8 + this.random() * 0.4));
  }
}
