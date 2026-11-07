import { describe, expect, it } from 'vitest';
import { fillStats, roundThousands } from './stats';

const projects = {
  kestrel: { commits: 1179, pullRequests: 90, lines: 161_481, testLines: 75_252 },
};

describe('fillStats', () => {
  it('leaves plain values alone', () => {
    expect(fillStats('Sole engineer', projects)).toBe('Sole engineer');
  });

  it('fills every token in a value', () => {
    expect(
      fillStats('$kestrel.productionLines production, $kestrel.testLines test', projects),
    ).toBe('86k production, 75k test');
    expect(fillStats('$kestrel.commits', projects)).toBe('1,179');
  });

  it('fails loudly on a token it does not know', () => {
    expect(() => fillStats('$kestrel.coverage', projects)).toThrow('Unknown stat');
    expect(() => fillStats('$missing.commits', projects)).toThrow('Unknown stat');
  });
});

describe('roundThousands', () => {
  it('rounds to the nearest thousand and leaves small numbers exact', () => {
    expect(roundThousands(414_676)).toBe('415k');
    expect(roundThousands(1_234_567)).toBe('1,235k');
    expect(roundThousands(742)).toBe('742');
  });
});
