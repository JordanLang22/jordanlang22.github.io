import type { Envelope } from '../sim/engine';

// Invented examples of one fact in different shapes. No real format, system, or customer data.
const SOURCE_FORMATS: Readonly<Record<string, (id: number) => string>> = {
  'source-a': (id) => `<order id="${id}" state="new"/>`,
  'source-b': (id) => `ORD|${id}|NEW`,
  'source-c': (id) => `id=${id};state=new`,
};

const PRODUCT_FORMATS: Readonly<Record<string, (id: number) => string>> = {
  'product-a': (id) => `Order(${id})`,
  'product-b': (id) => `<event ref="${id}"/>`,
  'product-c': (id) => `[${id},"new"]`,
};

const LABELS: Readonly<Record<string, string>> = {
  'source-a': 'Source A',
  'source-b': 'Source B',
  'source-c': 'Source C',
  'product-a': 'A',
  'product-b': 'B',
  'product-c': 'C',
};

const THREAD_BASE = 4400;

const encodeHtml = (value: string) => value.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const part = (label: string, value: string) => `${label} <b>${encodeHtml(value)}</b>`;

/** One line showing a message as it was received, as it is stored, and as each target gets it. */
export function describeTranslation(envelope: Envelope, targets: readonly string[]): string {
  const id = envelope.thread + THREAD_BASE;
  const arrow = '<i>to</i>';
  const stored = part('Store', `{"id":${id}}`);
  if (envelope.direction === 'return') {
    const product = LABELS[envelope.from] ?? envelope.from;
    const origin = LABELS[envelope.origin] ?? envelope.origin;
    const answer = PRODUCT_FORMATS[envelope.from]?.(id) ?? '';
    const back = SOURCE_FORMATS[envelope.origin]?.(id) ?? '';
    return `${part(`Product ${product}`, answer)}${arrow}${stored}${arrow}${part(origin, back)}`;
  }
  const source = part(
    LABELS[envelope.from] ?? envelope.from,
    SOURCE_FORMATS[envelope.from]?.(id) ?? '',
  );
  if (targets.length === 0) return `${source}${arrow}${stored}<i>held, no product routed</i>`;
  const outputs = targets
    .map((target) => part(LABELS[target] ?? target, PRODUCT_FORMATS[target]?.(id) ?? ''))
    .join('  ');
  return `${source}${arrow}${stored}${arrow}${outputs}`;
}
