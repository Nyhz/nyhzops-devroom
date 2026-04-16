import { describe, expect, it } from 'vitest';
import { add } from './index';

describe('add', () => {
  it('sums two numbers', () => {
    expect(add(1, 2)).toBe(3);
  });
});
