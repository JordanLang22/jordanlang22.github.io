import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/** Everything in this file is an enhancement: with motion off, the page is complete without it. */
export function startMotion(): void {
  if (!document.documentElement.classList.contains('motion')) return;
  gsap.registerPlugin(ScrollTrigger);

  revealStatement();
  openRecord();
  stackFiles();
  raiseRows('[data-order]');
  raiseRows('[data-log-row]');
  scanHeatmap();
  countUp();

  // Fonts change layout, and every trigger above measures layout.
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

function revealStatement(): void {
  const statement = document.querySelector<HTMLElement>('[data-reveal-words]');
  if (!statement) return;
  const text = statement.textContent ?? '';
  statement.setAttribute('aria-label', text);
  statement.setAttribute('role', 'text');
  statement.textContent = '';
  for (const [index, word] of text.split(' ').entries()) {
    const span = document.createElement('span');
    span.textContent = word;
    span.setAttribute('aria-hidden', 'true');
    statement.append(index === 0 ? '' : ' ', span);
  }
  gsap.fromTo(
    statement.querySelectorAll('span'),
    { color: '#2b3431' },
    {
      color: '#e9e4d8',
      stagger: 0.1,
      ease: 'none',
      scrollTrigger: { trigger: statement, start: 'top 78%', end: 'bottom 52%', scrub: 0.4 },
    },
  );
}

/** Redaction bars pull away and take the dark page with them, uncovering the paper record. */
function openRecord(): void {
  const opening = document.querySelector<HTMLElement>('[data-opening]');
  const bars = document.querySelectorAll<HTMLElement>('[data-bars] i');
  if (!opening || bars.length === 0) return;
  const PIN_VIEWPORTS = 0.8;
  const LEAD_VIEWPORTS = 0.72;
  ScrollTrigger.create({
    trigger: opening,
    start: 'top top',
    end: () => `+=${innerHeight * PIN_VIEWPORTS}`,
    pin: true,
  });
  gsap
    .timeline({
      scrollTrigger: {
        trigger: opening,
        start: `top ${LEAD_VIEWPORTS * 100}%`,
        end: () => `+=${innerHeight * (LEAD_VIEWPORTS + PIN_VIEWPORTS - 0.1)}`,
        scrub: 0.35,
      },
    })
    .to(bars, {
      scaleX: 0,
      ease: 'power2.inOut',
      duration: 1,
      stagger: { each: 0.09, from: 'random' },
    });
}

function stackFiles(): void {
  const files = [...document.querySelectorAll<HTMLElement>('[data-file]')];
  const stacked = matchMedia('(min-width: 861px)').matches;

  // A file taller than the screen sticks with its bottom edge in view, which needs its real height.
  // Fonts and wrapping change that height after load, so it is observed rather than measured once.
  const heights = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      if (target instanceof HTMLElement) {
        target.style.setProperty('--file-height', `${target.offsetHeight}px`);
      }
    }
  });
  for (const file of files) heights.observe(file);

  files.forEach((file, index) => {
    const stamp = file.querySelector('[data-stamp]');
    const bars = file.querySelectorAll('[data-bar]');
    if (stamp) gsap.set(stamp, { opacity: 0 });

    ScrollTrigger.create({
      trigger: file,
      start: 'top 55%',
      once: true,
      onEnter: () => {
        gsap.delayedCall(0.25, () => {
          bars.forEach((bar, position) => {
            gsap.delayedCall(position * 0.16, () => bar.classList.add('lifted'));
          });
        });
        if (stamp) {
          gsap.fromTo(
            stamp,
            { scale: 2.6, opacity: 0, rotate: -14 },
            { scale: 1, opacity: 1, rotate: -7, duration: 0.36, delay: 0.5, ease: 'back.out(2.2)' },
          );
          gsap.fromTo(
            file,
            { x: 0 },
            {
              keyframes: { x: [0, -3, 3, -1, 0] },
              duration: 0.22,
              delay: 0.72,
              clearProps: 'x',
            },
          );
        }
      },
    });

    const next = files[index + 1];
    if (next && stacked) {
      gsap.to(file, {
        scale: 0.965,
        '--shade': 0.28,
        ease: 'none',
        scrollTrigger: { trigger: next, start: 'top bottom', end: 'top top', scrub: true },
      });
    }
  });
}

function raiseRows(selector: string): void {
  for (const row of document.querySelectorAll<HTMLElement>(selector)) {
    gsap.from(row, {
      opacity: 0,
      y: 26,
      duration: 0.6,
      ease: 'power3.out',
      scrollTrigger: { trigger: row, start: 'top 92%', once: true },
    });
  }
}

function countUp(): void {
  const format = new Intl.NumberFormat('en-US');
  for (const output of document.querySelectorAll<HTMLElement>('[data-count]')) {
    const target = Number(output.dataset.count);
    const counter = { value: 0 };
    const tween = gsap.to(counter, {
      value: target,
      duration: 1.5,
      ease: 'power3.out',
      scrollTrigger: { trigger: output, start: 'top 90%', once: true },
      onUpdate: () => {
        output.textContent = format.format(Math.round(counter.value));
      },
    });
    // A printout made before scrolling this far must not say zero.
    addEventListener('beforeprint', () => tween.progress(1));
  }
}

function scanHeatmap(): void {
  const heatmap = document.querySelector('[data-heatmap]');
  if (!heatmap) return;
  gsap.from(heatmap.querySelectorAll('rect'), {
    opacity: 0,
    duration: 0.18,
    stagger: { each: 0.0024, from: 'start' },
    scrollTrigger: { trigger: heatmap, start: 'top 82%', once: true },
  });
}
