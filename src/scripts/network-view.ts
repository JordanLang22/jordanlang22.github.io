import type { Packet, SimSignal, Simulation } from '../sim/engine';

interface Point {
  x: number;
  y: number;
}

interface Shock extends Point {
  age: number;
  colour: string;
  reach: number;
}

const BONE = '233, 228, 216';
const FLARE = '255, 91, 31';
const ANSWER = '143, 211, 199';
const DIM = '143, 152, 146';
const TRAIL_LENGTH = 0.14;
const TRAIL_SAMPLES = 7;
const LANE_OFFSET = 3.5;
const SHOCK_FRAMES = 34;
const DROP_SHOCK_SPACING = 26;
const HUB_PADDING = 44;
const LINKS: readonly (readonly [string, string])[] = [
  ['source-a', 'ingest'],
  ['source-b', 'ingest'],
  ['source-c', 'ingest'],
  ['ingest', 'store'],
  ['store', 'translate'],
  ['translate', 'product-a'],
  ['translate', 'product-b'],
  ['translate', 'product-c'],
];
const PRODUCT_SHAPES: Readonly<Record<string, Shape>> = {
  'product-a': 'circle',
  'product-b': 'diamond',
  'product-c': 'triangle',
};

type Shape = 'square' | 'circle' | 'diamond' | 'triangle';

const linkKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function curvePoint(from: Point, to: Point, t: number, lane: number): Point {
  const span = (to.x - from.x) * 0.5;
  const c1 = from.x + span;
  const c2 = to.x - span;
  const u = 1 - t;
  return {
    x: u * u * u * from.x + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * to.x,
    y: u * u * u * from.y + 3 * u * u * t * from.y + 3 * u * t * t * to.y + t * t * t * to.y + lane,
  };
}

/** Draws links and traffic. The nodes themselves are real buttons sitting above this canvas. */
export class NetworkView {
  private readonly context: CanvasRenderingContext2D;
  private readonly anchors = new Map<string, Point>();
  private readonly heat = new Map<string, number>();
  private readonly lastDrop = new Map<string, number>();
  private shocks: Shock[] = [];
  private width = 0;
  private height = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly nodes: readonly HTMLElement[],
    private readonly sim: Simulation,
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable.');
    this.context = context;
    this.measure();
    new ResizeObserver(() => this.measure()).observe(canvas);
  }

  private measure(): void {
    const box = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.width = box.width;
    this.height = box.height;
    this.canvas.width = Math.round(box.width * ratio);
    this.canvas.height = Math.round(box.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    for (const node of this.nodes) {
      const rect = node.getBoundingClientRect();
      this.anchors.set(node.dataset.node ?? '', {
        x: rect.left + rect.width / 2 - box.left,
        y: rect.top + rect.height / 2 - box.top,
      });
    }
  }

  absorb(signals: readonly SimSignal[]): void {
    for (const signal of signals) {
      const anchor = this.anchors.get(signal.node);
      if (!anchor) continue;
      if (signal.type === 'dropped') {
        const previous = this.lastDrop.get(signal.node) ?? -Infinity;
        if (this.sim.tick - previous < DROP_SHOCK_SPACING) continue;
        this.lastDrop.set(signal.node, this.sim.tick);
        this.shocks.push({ ...anchor, age: 0, colour: FLARE, reach: 44 });
      } else if (signal.type === 'applied') {
        const returned = signal.delivery.envelope.direction === 'return';
        this.shocks.push({ ...anchor, age: 0, colour: returned ? ANSWER : BONE, reach: 22 });
      } else if (signal.type === 'deduplicated') {
        this.shocks.push({ ...anchor, age: 0, colour: FLARE, reach: 22 });
      }
    }
  }

  /** A hit that did not come from the simulation's own signals, such as a crash. */
  jolt(node: string): void {
    const anchor = this.anchors.get(node);
    if (anchor) this.shocks.push({ ...anchor, age: 0, colour: FLARE, reach: 64 });
  }

  draw(fraction: number): void {
    const { context, sim } = this;
    context.clearRect(0, 0, this.width, this.height);
    this.drawHub();
    this.drawLinks();
    for (const packet of sim.packets) this.drawPacket(packet, fraction);
    this.drawBacklog();
    this.drawShocks();
  }

  private drawHub(): void {
    const { context } = this;
    const ingest = this.anchors.get('ingest');
    const translate = this.anchors.get('translate');
    if (!ingest || !translate) return;
    const left = ingest.x - HUB_PADDING;
    const top = ingest.y - HUB_PADDING - 14;
    const width = translate.x - ingest.x + HUB_PADDING * 2;
    const height = (HUB_PADDING + 14) * 2;
    context.setLineDash([2, 5]);
    context.lineWidth = 1;
    context.strokeStyle = `rgba(${DIM}, 0.5)`;
    context.strokeRect(left, top, width, height);
    context.setLineDash([]);
    context.fillStyle = `rgb(${DIM})`;
    context.font = "11px 'JetBrains Mono Variable', monospace";
    context.textAlign = 'left';
    context.fillText('Hub', left, top - 6);
  }

  private drawLinks(): void {
    const { context, sim } = this;
    for (const [a, b] of LINKS) {
      const from = this.anchors.get(a);
      const to = this.anchors.get(b);
      if (!from || !to) continue;
      const key = linkKey(a, b);
      const heat = (this.heat.get(key) ?? 0) * 0.94;
      this.heat.set(key, heat);
      const severed = !sim.nodes.get(a)?.up || !sim.nodes.get(b)?.up;
      const unrouted = sim.routing.get(b) === false;
      const span = (to.x - from.x) * 0.5;
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.bezierCurveTo(from.x + span, from.y, to.x - span, to.y, to.x, to.y);
      context.setLineDash(severed ? [3, 6] : unrouted ? [1, 7] : []);
      context.lineWidth = 1;
      if (severed) context.strokeStyle = `rgba(${FLARE}, 0.45)`;
      else if (unrouted) context.strokeStyle = `rgba(${DIM}, 0.4)`;
      else context.strokeStyle = `rgba(${BONE}, ${(0.13 + Math.min(heat, 1) * 0.28).toFixed(3)})`;
      context.stroke();
    }
    context.setLineDash([]);
  }

  private drawPacket(packet: Packet, fraction: number): void {
    const { context, sim } = this;
    const from = this.anchors.get(packet.from);
    const to = this.anchors.get(packet.to);
    if (!from || !to) return;
    const key = linkKey(packet.from, packet.to);
    this.heat.set(key, (this.heat.get(key) ?? 0) + 0.03);

    const span = packet.arrives - packet.departed;
    const progress = Math.min(1, (sim.tick + fraction - packet.departed) / span);
    const eased = progress * progress * (3 - 2 * progress);
    const acknowledgement = packet.kind === 'submit-ack' || packet.kind === 'deliver-ack';
    const lane = to.x > from.x ? -LANE_OFFSET : LANE_OFFSET;
    const colour = packet.retry ? FLARE : packet.direction === 'return' ? ANSWER : BONE;
    const baseAlpha = acknowledgement ? 0.24 : 1;

    context.lineWidth = acknowledgement ? 1 : 1.5;
    let previous = curvePoint(from, to, Math.max(0, eased - TRAIL_LENGTH), lane);
    for (let sample = 1; sample <= TRAIL_SAMPLES; sample += 1) {
      const t = Math.max(0, eased - TRAIL_LENGTH * (1 - sample / TRAIL_SAMPLES));
      const point = curvePoint(from, to, t, lane);
      context.strokeStyle = `rgba(${colour}, ${((sample / TRAIL_SAMPLES) * baseAlpha * 0.85).toFixed(3)})`;
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(point.x, point.y);
      context.stroke();
      previous = point;
    }

    context.fillStyle = `rgba(${colour}, ${baseAlpha})`;
    if (acknowledgement) {
      context.fillRect(previous.x - 1, previous.y - 1, 2, 2);
    } else {
      // Past the translate station a message is in that product's format, so it changes shape.
      const product = PRODUCT_SHAPES[packet.to] ?? PRODUCT_SHAPES[packet.from];
      this.fillShape(product ?? 'square', previous);
    }
  }

  private fillShape(shape: Shape, { x, y }: Point): void {
    const { context } = this;
    context.beginPath();
    if (shape === 'square') {
      context.rect(x - 2, y - 2, 4, 4);
    } else if (shape === 'circle') {
      context.arc(x, y, 3.2, 0, Math.PI * 2);
    } else if (shape === 'diamond') {
      context.moveTo(x, y - 4.2);
      context.lineTo(x + 4.2, y);
      context.lineTo(x, y + 4.2);
      context.lineTo(x - 4.2, y);
    } else {
      context.moveTo(x, y - 4.2);
      context.lineTo(x + 4.2, y + 3.2);
      context.lineTo(x - 4.2, y + 3.2);
    }
    context.fill();
  }

  private drawBacklog(): void {
    const { context, sim } = this;
    const anchor = this.anchors.get('store');
    if (!anchor) return;
    const held = Math.min(sim.storeDepth, 72);
    context.fillStyle = `rgb(${FLARE})`;
    for (let index = 0; index < held; index += 1) {
      const column = index % 18;
      const row = Math.floor(index / 18);
      context.fillRect(anchor.x - 22 + column * 2.6, anchor.y + 24 + row * 5, 1.6, 3.5);
    }
  }

  private drawShocks(): void {
    const { context } = this;
    this.shocks = this.shocks.filter((shock) => {
      shock.age += 1;
      const progress = shock.age / SHOCK_FRAMES;
      const half = 11 + shock.reach * (1 - (1 - progress) ** 3);
      context.lineWidth = 1;
      context.strokeStyle = `rgba(${shock.colour}, ${((1 - progress) * 0.8).toFixed(3)})`;
      context.strokeRect(shock.x - half, shock.y - half, half * 2, half * 2);
      return shock.age < SHOCK_FRAMES;
    });
  }
}
