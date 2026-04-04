import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSocket, useReconnectKey } from '@/hooks/use-socket';
import { mockSocket } from '@/lib/test/component-setup';

describe('useSocket', () => {
  it('returns the mock socket from context', () => {
    const { result } = renderHook(() => useSocket());
    expect(result.current).toBe(mockSocket);
  });

  it('has expected socket methods', () => {
    const { result } = renderHook(() => useSocket());
    expect(result.current!.on).toBeDefined();
    expect(result.current!.off).toBeDefined();
    expect(result.current!.emit).toBeDefined();
  });

  it('returns the same socket across re-renders', () => {
    const { result, rerender } = renderHook(() => useSocket());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('useReconnectKey', () => {
  it('returns the reconnect key from context', () => {
    const { result } = renderHook(() => useReconnectKey());
    expect(result.current).toBe(0);
  });
});
