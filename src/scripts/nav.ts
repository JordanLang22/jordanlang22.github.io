/**
 * Colours the fixed bar to match the section under it, and marks the section being read. Runs with
 * or without motion: it is how the bar stays legible, not decoration.
 */
export function startNav(): void {
  const nav = document.querySelector<HTMLElement>('[data-nav]');
  if (!nav) return;
  const zones = [...document.querySelectorAll<HTMLElement>('[data-nav-tone]')];
  const links = [...nav.querySelectorAll<HTMLAnchorElement>('nav a[href^="#"]')].flatMap((link) => {
    const section = document.getElementById(link.hash.slice(1));
    return section ? [{ link, section }] : [];
  });

  const update = () => {
    const line = nav.offsetHeight / 2;
    let tone = 'ink';
    for (const zone of zones) {
      const box = zone.getBoundingClientRect();
      if (box.top <= line && box.bottom > line) tone = zone.dataset.navTone ?? tone;
    }
    nav.dataset.tone = tone;
    nav.toggleAttribute('data-scrolled', scrollY > 8);

    const reading = innerHeight * 0.4;
    const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
    let current = atEnd ? links.at(-1) : undefined;
    if (!current) {
      for (const entry of links) {
        if (entry.section.getBoundingClientRect().top <= reading) current = entry;
      }
    }
    for (const entry of links) {
      if (entry === current) entry.link.setAttribute('aria-current', 'true');
      else entry.link.removeAttribute('aria-current');
    }
  };

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  update();
}
