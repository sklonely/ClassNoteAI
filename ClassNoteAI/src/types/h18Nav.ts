/**
 * H18 nav state machine — Phase 6 IA
 *
 * 對應 docs/design/h18-deep/h18-app.jsx 裡 H18DeepApp 的 activeNav。
 * 一律字串 key（含 colon-encoded id），避免 enum 跟 dynamic course id 打架。
 */

export type H18ActiveNav =
    | 'home'
    | 'notes'                            // ▤ 知識庫 (P6.9)
    | 'ai'                               // ✦ AIPage (full screen, P6.6)
    | 'profile'                          // 👤 ProfilePage (P6.7)
    | `course:${string}`                 // course detail
    | `recording:${string}`              // recording mode for course id
    | `review:${string}:${string}`;      // review mode for course id + lecture id

export type H18OverlayNav = 'search' | 'add' | null;

/** 把 activeNav 解析成 case-router 友善的 tag。 */
export function parseNav(nav: H18ActiveNav):
    | { kind: 'home' }
    | { kind: 'notes' }
    | { kind: 'ai' }
    | { kind: 'profile' }
    | { kind: 'course'; courseId: string }
    | { kind: 'recording'; courseId: string }
    | { kind: 'review'; courseId: string; lectureId: string } {
    if (nav === 'home') return { kind: 'home' };
    if (nav === 'notes') return { kind: 'notes' };
    if (nav === 'ai') return { kind: 'ai' };
    if (nav === 'profile') return { kind: 'profile' };
    if (nav.startsWith('course:')) {
        return { kind: 'course', courseId: nav.slice('course:'.length) };
    }
    if (nav.startsWith('recording:')) {
        return { kind: 'recording', courseId: nav.slice('recording:'.length) };
    }
    if (nav.startsWith('review:')) {
        const rest = nav.slice('review:'.length);
        const idx = rest.indexOf(':');
        return {
            kind: 'review',
            courseId: idx === -1 ? rest : rest.slice(0, idx),
            lectureId: idx === -1 ? '' : rest.slice(idx + 1),
        };
    }
    // exhaustive fallback
    return { kind: 'home' };
}
