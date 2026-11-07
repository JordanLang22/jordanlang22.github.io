import { describe, expect, it } from 'vitest';
import { parseRedactions } from './redaction';

describe('parseRedactions', () => {
  it('leaves plain copy alone', () => {
    expect(parseRedactions('Nothing to hide.')).toEqual([
      { kind: 'text', text: 'Nothing to hide.' },
    ]);
  });

  it('splits open and sealed bars from the text around them', () => {
    expect(parseRedactions('A [[lifted]] b {{9|strategy}}.')).toEqual([
      { kind: 'text', text: 'A ' },
      { kind: 'open', text: 'lifted' },
      { kind: 'text', text: ' b ' },
      { kind: 'sealed', width: 9, reason: 'strategy' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('handles adjacent bars', () => {
    expect(parseRedactions('[[a]]{{2|b}}')).toEqual([
      { kind: 'open', text: 'a' },
      { kind: 'sealed', width: 2, reason: 'b' },
    ]);
  });
});
