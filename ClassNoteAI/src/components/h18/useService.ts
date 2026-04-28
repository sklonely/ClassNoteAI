/**
 * useService · Phase 7 Sprint 0 (S0.9)
 *
 * 訂閱一個 service singleton 的 state，自動 cleanup on unmount。
 * 解掉散落各 component 的 boilerplate：
 *
 *   const [state, setState] = useState(svc.getState());
 *   useEffect(() => svc.subscribe(setState), []);
 *
 * 改用 React 18 的 `useSyncExternalStore` 避免 tearing。
 *
 * 要求 service 提供 `getState()` 同步讀 + `subscribe(cb)` 回傳 unsubscribe fn。
 */

import { useCallback, useSyncExternalStore } from 'react';

export interface ServiceLike<T> {
    getState(): T;
    subscribe(cb: (state: T) => void): () => void;
}

export function useService<T>(svc: ServiceLike<T>): T {
    // useSyncExternalStore 要求 subscribe fn ref 在 deps 不變時保持穩定，
    // 否則每次 re-render 都會 unsubscribe → re-subscribe，造成不必要的
    // listener churn。用 useCallback 鎖在 svc identity 上。
    const subscribe = useCallback(
        (onStoreChange: () => void) => svc.subscribe(() => onStoreChange()),
        [svc],
    );

    const getSnapshot = useCallback(() => svc.getState(), [svc]);

    return useSyncExternalStore<T>(
        subscribe,
        getSnapshot,
        // getServerSnapshot — SSR/hydration 用同一個 snapshot 即可
        getSnapshot,
    );
}
