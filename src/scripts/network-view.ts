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
const TRAIL_LENGTH = 0.11;
const TRAIL_SAMPLES = 7;
const SHOCK_FRAMES = 34;
const LINKS: readonly (readonly [string, string])[] = [
  ['cad', 'outbox'],
  ['phones', 'outbox'],
  ['radio', 'outbox'],
  ['outbox', 'relay-a'],
  ['outbox', 'relay-b'],
  ['relay-a', 'agency-1'],
  ['relay-a', 'agency-2'],
  ['relay-a', 'agency-3'],
  ['relay-b', 'agency-1'],
  ['relay-b', 'agency-2'],
  ['relay-b', 'agency-3'],
];

const linkKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function curvePoint(from: Point, to: Point, t: number): Point {
  const span = (to.x - from.x) * 0.5;
  const c1 = from.x + span;
  const c2 = to.x - span;
  const u = 1 - t;
  return {
    x: u * u * u * from.x + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * to.x,
    y: u * u * u * from.y + 3 * u * u * t * from.y + 3 * u * t * t * to.y + t * t * t * to.y,
  };
}

/** Draws links and traffic. The nodes themselves are real buttons sitting above this canvas. */
export class NetworkView {
  private readonly context: CanvasRenderingContext2D;
  private readonly anchors = new Map<string, Point>();
  private readonly heat = new Map<string, number>();
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
        this.shocks.push({ ...anchor, age: 0, colour: FLARE, reach: 44 });
      } else {
        this.shocks.push({
          ...anchor,
          age: 0,
          colour: signal.type === 'applied' ? BONE : FLARE,
          reach: 22,
        });
      }
    }
  }

  draw(fraction: number): void {
    const { context, sim } = this;
    context.clearRect(0, 0, this.width, this.height);
    this.drawLinks();
    for (const packet of sim.packets) this.drawPacket(packet, fraction);
    this.drawBacklog();
    this.drawShocks();
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
      context.beginPath();
      context.moveTo(from.x, from.y);
      const span = (to.x - from.x) * 0.5;
      context.bezierCurveTo(from.x + span, from.y, to.x - span, to.y, to.x, to.y);
      context.setLineDash(severed ? [3, 6] : []);
      context.lineWidth = 1;
      context.strokeStyle = severed
        ? `rgba(${FLARE}, 0.45)`
        : `rgba(${BONE}, ${(0.14 + Math.min(heat, 1) * 0.3).toFixed(3)})`;
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
    this.heat.set(key, (this.heat.get(key) ?? 0) + 0.04);

    const span = packet.arrives - packet.departed;
    const progress = Math.min(1, (sim.tick + fraction - packet.departed) / span);
    const eased = progress * progress * (3 - 2 * progress);
    const acknowledgement =
      packet.kind === 'ack' || packet.kind === 'ack-relay' || packet.kind === 'commit-ack';
    const colour = packet.retry ? FLARE : BONE;
    const baseAlpha = acknowledgement ? 0.28 : 1;

    context.lineWidth = acknowledgement ? 1 : 1.5;
    let previous = curvePoint(from, to, Math.max(0, eased - TRAIL_LENGTH));
    for (let sample = 1; sample <= TRAIL_SAMPLES; sample += 1) {
      const t = Math.max(0, eased - TRAIL_LENGTH * (1 - sample / TRAIL_SAMPLES));
      const point = curvePoint(from, to, t);
      context.strokeStyle = `rgba(${colour}, ${((sample / TRAIL_SAMPLES) * baseAlpha * 0.9).toFixed(3)})`;
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(point.x, point.y);
      context.stroke();
      previous = point;
    }
    const size = acknowledgement ? 2 : 3.5;
    context.fillStyle = `rgba(${colour}, ${baseAlpha})`;
    context.fillRect(previous.x - size / 2, previous.y - size / 2, size, size);
  }

  private drawBacklog(): void {
    const { context, sim } = this;
    const anchor = this.anchors.get('outbox');
    if (!anchor) return;
    const held = Math.min(sim.outboxDepth, 72);
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
