/**
 * useService hook tests · Phase 7 Sprint 0 (S0.9)
 *
 * 統一 service singleton subscribe pattern。
 * 規格：
 *   - mount 取得 svc.getState() 初始值
 *   - svc 通知 → re-render 拿新 state
 *   - unmount → unsubscribe 被呼叫
 *   - unmount 後 svc 再 setState 不會觸發 setState warning
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useService, type ServiceLike } from '../useService';

interface FakeService<T> extends ServiceLike<T> {
  setState: (next: T) => void;
  subscribeSpy: ReturnType<typeof vi.fn>;
  unsubscribeSpy: ReturnType<typeof vi.fn>;
}

function makeFakeService<T>(initial: T): FakeService<T> {
  let state = initial;
  const subscribers = new Set<(s: T) => void>();
  const unsubscribeSpy = vi.fn();
  const subscribeSpy = vi.fn((cb: (s: T) => void) => {
    subscribers.add(cb);
    return () => {
      unsubscribeSpy();
      subscribers.delete(cb);
    };
  });
  return {
    getState: () => state,
    subscribe: subscribeSpy as unknown as ServiceLike<T>['subscribe'],
    setState: (next: T) => {
      state = next;
      subscribers.forEach(cb => cb(state));
    },
    subscribeSpy,
    unsubscribeSpy,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useService', () => {
  it('returns initial state from svc.getState() on mount', () => {
    const svc = makeFakeService({ count: 0 });
    const { result } = renderHook(() => useService(svc));
    expect(result.current).toEqual({ count: 0 });
  });

  it('subscribes to svc on mount', () => {
    const svc = makeFakeService({ count: 0 });
    renderHook(() => useService(svc));
    expect(svc.subscribeSpy).toHaveBeenCalledTimes(1);
    expect(svc.subscribeSpy).toHaveBeenCalledWith(expect.any(Function));
  });

  it('re-renders with new state when svc notifies', () => {
    const svc = makeFakeService({ count: 0 });
    const { result } = renderHook(() => useService(svc));

    expect(result.current).toEqual({ count: 0 });

    act(() => {
      svc.setState({ count: 1 });
    });

    expect(result.current).toEqual({ count: 1 });

    act(() => {
      svc.setState({ count: 42 });
    });

    expect(result.current).toEqual({ count: 42 });
  });

  it('preserves generic type (string state)', () => {
    const svc = makeFakeService<string>('hello');
    const { result } = renderHook(() => useService(svc));
    expect(result.current).toBe('hello');

    act(() => {
      svc.setState('world');
    });

    expect(result.current).toBe('world');
  });

  it('calls unsubscribe on unmount', () => {
    const svc = makeFakeService({ count: 0 });
    const { unmount } = renderHook(() => useService(svc));

    expect(svc.unsubscribeSpy).not.toHaveBeenCalled();
    unmount();
    expect(svc.unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('does not warn / setState on unmounted component when svc emits later', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

    const svc = makeFakeService({ count: 0 });
    const { unmount } = renderHook(() => useService(svc));
    unmount();

    // svc emits after unmount — should not trigger React update warning
    act(() => {
      svc.setState({ count: 1 });
    });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('multiple consumers each receive updates and each unsubscribe on unmount', () => {
    const svc = makeFakeService({ count: 0 });
    const a = renderHook(() => useService(svc));
    const b = renderHook(() => useService(svc));

    expect(svc.subscribeSpy).toHaveBeenCalledTimes(2);

    act(() => {
      svc.setState({ count: 7 });
    });

    expect(a.result.current).toEqual({ count: 7 });
    expect(b.result.current).toEqual({ count: 7 });

    a.unmount();
    expect(svc.unsubscribeSpy).toHaveBeenCalledTimes(1);

    b.unmount();
    expect(svc.unsubscribeSpy).toHaveBeenCalledTimes(2);
  });
});
