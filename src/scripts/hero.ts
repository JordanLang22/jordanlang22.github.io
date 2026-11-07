import { gsap } from 'gsap';
import { type SimSignal, Simulation, TOPOLOGY } from '../sim/engine';
import { NetworkView } from './network-view';
import { describeTranslation } from './translation-sample';

const TICK_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 4;
const AUTO_HEAL_MS = 11_000;
const FIRST_DRILL_MS = 6_000;
const DRILL_INTERVAL_MS = 13_000;
const DRILL_LENGTH_MS = 4_500;
const TRANSLATION_INTERVAL_MS = 1_300;
const DRILLS = ['translate', 'route:product-b', 'store', 'product-c', 'ingest', 'route:product-a'];

const number = new Intl.NumberFormat('en-US');

export function startHero(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#network-canvas');
  const status = document.querySelector<HTMLElement>('#sim-status');
  const toggle = document.querySelector<HTMLButtonElement>('#sim-toggle');
  const hero = document.querySelector<HTMLElement>('#top');
  const translation = document.querySelector<HTMLElement>('#translation');
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-node]')];
  const switches = [...document.querySelectorAll<HTMLButtonElement>('[data-route]')];
  if (!canvas || !status || !toggle || !hero || !translation) return;

  const reducedMotion = !document.documentElement.classList.contains('motion');
  const sim = new Simulation({ seed: Math.floor(Math.random() * 2 ** 31) });
  const view = new NetworkView(canvas, buttons, sim);
  const healAt = new Map<string, number>();
  const outputs = {
    delivered: document.querySelector('#stat-delivered'),
    returned: document.querySelector('#stat-returned'),
    retried: document.querySelector('#stat-retried'),
    deduplicated: document.querySelector('#stat-deduplicated'),
    lost: document.querySelector('#stat-lost'),
  };

  let paused = reducedMotion;
  let visible = true;
  let touched = false;
  let nextDrill = performance.now() + FIRST_DRILL_MS;
  let accumulator = 0;
  let last = performance.now();
  let lastCounters = 0;
  let lastTranslation = 0;
  let drillIndex = 0;

  const say = (message: string) => {
    status.textContent = message;
  };

  const renderControl = () => {
    toggle.textContent = paused ? 'Run' : 'Pause';
    toggle.setAttribute('aria-pressed', String(paused));
  };

  const setNode = (button: HTMLButtonElement, up: boolean) => {
    const id = button.dataset.node ?? '';
    const label = button.dataset.label ?? id;
    sim.setUp(id, up);
    button.setAttribute('aria-pressed', String(!up));
    button.setAttribute(
      'aria-label',
      `${up ? 'Take' : 'Restore'} ${label} ${up ? 'down' : ''}`.trim(),
    );
    if (up) healAt.delete(id);
    else healAt.set(id, performance.now() + AUTO_HEAL_MS);
    const down = [...sim.nodes.values()].filter((node) => !node.up).length;
    if (down > 0) document.documentElement.dataset.degraded = '';
    else delete document.documentElement.dataset.degraded;
    return { label, down };
  };

  for (const button of buttons) {
    button.addEventListener('click', () => {
      touched = true;
      const wasUp = button.getAttribute('aria-pressed') !== 'true';
      const { label, down } = setNode(button, !wasUp);
      if (down === TOPOLOGY.length) say('Everything is down. Every message is still held.');
      else if (wasUp) say(`${label} is down. Nothing gets dropped. Watch the retries.`);
      else say(`${label} is back. The backlog is draining.`);
    });
  }

  const setRoute = (button: HTMLButtonElement, on: boolean) => {
    sim.setRouting(button.dataset.route ?? '', on);
    button.setAttribute('aria-checked', String(on));
    return button.dataset.label ?? '';
  };

  for (const button of switches) {
    button.addEventListener('click', () => {
      touched = true;
      const on = button.getAttribute('aria-checked') !== 'true';
      const label = setRoute(button, on);
      say(
        on
          ? `${label} is routed again. New messages reach it from here on.`
          : `${label} is switched off. Nothing failed, it just stops receiving.`,
      );
    });
  }

  toggle.addEventListener('click', () => {
    paused = !paused;
    renderControl();
  });
  renderControl();

  new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
  }).observe(hero);

  /** Until someone takes over, the system runs its own failure drill so nobody misses the point. */
  const runDrill = (now: number) => {
    if (touched || now < nextDrill || paused) return;
    nextDrill = now + DRILL_INTERVAL_MS;
    const drill = DRILLS[drillIndex % DRILLS.length] ?? '';
    drillIndex += 1;

    if (drill.startsWith('route:')) {
      const target = switches.find((button) => `route:${button.dataset.route}` === drill);
      if (!target) return;
      const label = setRoute(target, false);
      say(`Routing change: ${label} switched off. The others keep receiving.`);
      window.setTimeout(() => {
        if (touched) return;
        setRoute(target, true);
        say(`${label} is routed again. Your turn: flip a switch or take a node down.`);
      }, DRILL_LENGTH_MS);
      return;
    }

    const target = buttons.find((button) => button.dataset.node === drill);
    if (!target) return;
    const { label } = setNode(target, false);
    say(`Failure drill: ${label} just went down. Nobody touched it.`);
    window.setTimeout(() => {
      if (touched) return;
      setNode(target, true);
      say(`${label} is back and the backlog is draining. Your turn: take one down.`);
    }, DRILL_LENGTH_MS);
  };

  const renderCounters = (now: number) => {
    if (now - lastCounters < 120) return;
    lastCounters = now;
    if (outputs.delivered) outputs.delivered.textContent = number.format(sim.stats.delivered);
    if (outputs.returned) outputs.returned.textContent = number.format(sim.stats.returned);
    if (outputs.retried) outputs.retried.textContent = number.format(sim.stats.retried);
    if (outputs.deduplicated) {
      outputs.deduplicated.textContent = number.format(sim.stats.deduplicated);
    }
    if (outputs.lost) outputs.lost.textContent = number.format(sim.lost());
  };

  const showTranslation = (signals: readonly SimSignal[], now: number) => {
    if (now - lastTranslation < TRANSLATION_INTERVAL_MS) return;
    for (const signal of signals) {
      if (signal.type !== 'stored') continue;
      lastTranslation = now;
      translation.innerHTML = describeTranslation(signal.envelope, signal.targets);
      return;
    }
  };

  const frame = (now: number) => {
    const elapsed = Math.min(now - last, 100);
    last = now;
    if (visible && !document.hidden) {
      if (!paused) {
        accumulator += elapsed;
        let steps = 0;
        while (accumulator >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
          const signals = sim.step();
          view.absorb(signals);
          showTranslation(signals, now);
          accumulator -= TICK_MS;
          steps += 1;
        }
        if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
        runDrill(now);
      }
      for (const [id, due] of healAt) {
        if (now >= due) {
          const button = buttons.find((candidate) => candidate.dataset.node === id);
          if (button) say(`${setNode(button, true).label} recovered. The backlog is draining.`);
        }
      }
      view.draw(paused ? 0 : accumulator / TICK_MS);
      renderCounters(now);
    }
    requestAnimationFrame(frame);
  };

  if (reducedMotion) {
    for (let tick = 0; tick < 240; tick += 1) sim.step();
    view.draw(0);
    renderCounters(performance.now());
    say('Paused because you prefer reduced motion. Press Run to start it.');
  }
  deliverHeadline();
  requestAnimationFrame(frame);
}

/**
 * The headline arrives over the same protocol as everything else: letters land out of order, one
 * packet is lost, and it is retried until it lands. The accent word is the one that had to retry.
 */
function deliverHeadline(): void {
  const root = document.documentElement;
  if (!root.classList.contains('intro')) return;

  const hero = document.querySelector<HTMLElement>('#top');
  const chars = [...document.querySelectorAll<HTMLElement>('#hero-title .char')];
  const failing = document.querySelector<HTMLElement>('#hero-title .accent .char');
  if (!hero || chars.length === 0 || !failing) {
    root.classList.remove('intro');
    return;
  }

  const failsafe = window.setTimeout(() => root.classList.remove('intro'), 4_000);
  const heroBox = hero.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2';
  hero.append(layer);

  const packetFor = (char: HTMLElement, colour: string) => {
    const box = char.getBoundingClientRect();
    const packet = document.createElement('i');
    packet.style.cssText = `position:absolute;left:0;top:0;width:18px;height:3px;background:${colour}`;
    layer.append(packet);
    return {
      packet,
      x: box.left - heroBox.left + box.width / 2,
      y: box.top - heroBox.top + box.height * 0.55,
    };
  };

  const land = (char: HTMLElement, colour: string) => {
    gsap.fromTo(
      char,
      { opacity: 1, scaleY: 1.5, y: -8, color: '#ffffff', transformOrigin: '50% 100%' },
      {
        scaleY: 1,
        y: 0,
        color: colour,
        duration: 0.42,
        ease: 'expo.out',
        clearProps: 'color,transform',
      },
    );
  };

  const shuffled = chars
    .filter((char) => char !== failing)
    .map((char) => ({ char, order: Math.random() }))
    .sort((a, b) => a.order - b.order);

  const timeline = gsap.timeline({
    onComplete: () => {
      window.clearTimeout(failsafe);
      root.classList.remove('intro');
      gsap.set(chars, { clearProps: 'opacity' });
      layer.remove();
    },
  });

  shuffled.forEach(({ char }, index) => {
    const { packet, x, y } = packetFor(char, '#e9e4d8');
    const colour = char.closest('.accent') ? '#ff5b1f' : '#e9e4d8';
    timeline.fromTo(
      packet,
      { x: -40, y, opacity: 1 },
      {
        x,
        duration: 0.38,
        ease: 'power2.in',
        onComplete: () => {
          packet.remove();
          land(char, colour);
        },
      },
      index * 0.026,
    );
  });

  const { packet: lost, x, y } = packetFor(failing, '#ff5b1f');
  timeline.fromTo(
    lost,
    { x: -40, y, opacity: 1 },
    { x: x - 70, duration: 0.42, ease: 'power2.in' },
    0.2,
  );
  timeline.to(lost, { opacity: 0, duration: 0.14, repeat: 3, yoyo: true });
  timeline.fromTo(
    lost,
    { x: -40, opacity: 1 },
    {
      x,
      duration: 0.34,
      ease: 'power2.in',
      onComplete: () => {
        lost.remove();
        land(failing, '#ff5b1f');
      },
    },
    '>0.12',
  );
  timeline.to({}, { duration: 0.44 });
}
