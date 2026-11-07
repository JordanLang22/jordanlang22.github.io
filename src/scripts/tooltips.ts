/** Keeps a sealed bar's tooltip on screen when the bar sits near the right edge. */
export function startTooltips(): void {
  const place = (event: Event) => {
    const { target } = event;
    if (!(target instanceof Element) || !target.matches('[data-reason]')) return;
    target.classList.toggle('flip', target.getBoundingClientRect().left > innerWidth * 0.6);
  };
  document.addEventListener('pointerover', place);
  document.addEventListener('focusin', place);
}
