import { describe, expect, it } from 'vitest';
import { add } from './index';

describe('add (red main)', () => {
  it('intentionally fails to simulate a red main', () => {
    expect(add(1, 2)).toBe(4);
  });
});
