import type { Envelope } from '../sim/engine';

// Invented examples of the same fact in different shapes. No real format or customer data.
const AGENCY_FORMATS: Readonly<Record<string, (id: number) => string>> = {
  cad: (id) => `<incident id="${id}" code="MVA"/>`,
  phones: (id) => `ANI 208-555-01${String(id % 100).padStart(2, '0')} call=${id}`,
  radio: (id) => `TG 4102 unit 22 event=${id}`,
};

const PRODUCT_FORMATS: Readonly<Record<string, (id: number) => string>> = {
  'product-a': (id) => `Call(${id})`,
  'product-b': (id) => `<event ref="${id}"/>`,
  'product-c': (id) => `[${id},"open"]`,
};

const LABELS: Readonly<Record<string, string>> = {
  cad: 'CAD',
  phones: 'Phones',
  radio: 'Radio',
  'product-a': 'A',
  'product-b': 'B',
  'product-c': 'C',
};

const INCIDENT_BASE = 4400;

const encodeHtml = (value: string) => value.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const part = (label: string, value: string) => `${label} <b>${encodeHtml(value)}</b>`;

/** One line showing a message as it was received, as it is stored, and as each target gets it. */
export function describeTranslation(envelope: Envelope, targets: readonly string[]): string {
  const id = envelope.incident + INCIDENT_BASE;
  const arrow = '<i>to</i>';
  const stored = part('Store', `{"incident":${id}}`);
  if (envelope.direction === 'return') {
    const product = LABELS[envelope.from] ?? envelope.from;
    const agency = LABELS[envelope.agency] ?? envelope.agency;
    const answer = PRODUCT_FORMATS[envelope.from]?.(id) ?? '';
    const back = AGENCY_FORMATS[envelope.agency]?.(id) ?? '';
    return `${part(`Product ${product}`, answer)}${arrow}${stored}${arrow}${part(agency, back)}`;
  }
  const source = part(
    LABELS[envelope.from] ?? envelope.from,
    AGENCY_FORMATS[envelope.from]?.(id) ?? '',
  );
  if (targets.length === 0) return `${source}${arrow}${stored}<i>held, no product routed</i>`;
  const outputs = targets
    .map((target) => part(LABELS[target] ?? target, PRODUCT_FORMATS[target]?.(id) ?? ''))
    .join('  ');
  return `${source}${arrow}${stored}${arrow}${outputs}`;
}
