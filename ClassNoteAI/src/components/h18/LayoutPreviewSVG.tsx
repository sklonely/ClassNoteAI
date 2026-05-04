/**
 * LayoutPreviewSVG · v0.7.0 H18
 *
 * 抽象化的 home / 錄音頁 mini-mockup，給 PAppearance 的 A/B/C
 * 切換預覽用。
 *
 * 對應 prototype docs/design/h18-deep/h18-nav-pages.jsx L2492+
 * (LayoutPreviewSVG)。
 *
 * 320×200 viewBox：
 *   - top bar 14px (traffic lights + recording island + brand)
 *   - left rail 14px (home/notes + 5 course color blocks + AI/profile)
 *   - 主內容區根據 variant 切版
 */

import s from './LayoutPreviewSVG.module.css';

const COURSE_COLORS = ['#3451b2', '#1f7a4f', '#9e3a24', '#6a3da0', '#1d6477'];

export type PreviewKind = 'home' | 'recording';
export type Variant = 'A' | 'B' | 'C';

export interface LayoutPreviewSVGProps {
    kind: PreviewKind;
    variant: Variant;
    /** light / dark for color sampling */
    theme: 'light' | 'dark';
}

interface Tokens {
    bg: string;
    surface: string;
    surface2: string;
    rail: string;
    topbar: string;
    border: string;
    borderSoft: string;
    text: string;
    textDim: string;
    textFaint: string;
    accent: string;
    hot: string;
    hotBg: string;
    invert: string;
    invertInk: string;
}

// Token snapshots — pure SVG, can't use CSS vars cleanly so inline real hex.
const TOKENS: Record<'light' | 'dark', Tokens> = {
    light: {
        bg: '#f5f2ea',
        surface: '#ffffff',
        surface2: '#faf8f3',
        rail: '#efece4',
        topbar: '#ffffff',
        border: '#e8e3d6',
        borderSoft: '#efeae0',
        text: '#15140f',
        textDim: '#908977',
        textFaint: '#b9b2a0',
        accent: '#d24a1a',
        hot: '#b54b12',
        hotBg: '#fde4d4',
        invert: '#111111',
        invertInk: '#fafaf7',
    },
    dark: {
        bg: '#16151a',
        surface: '#1e1d24',
        surface2: '#252430',
        rail: '#1a1920',
        topbar: '#1a1920',
        border: '#2f2d38',
        borderSoft: '#272530',
        text: '#f0ede4',
        textDim: '#7d786a',
        textFaint: '#4f4b42',
        accent: '#ffab7a',
        hot: '#ffab7a',
        hotBg: 'rgba(240,130,80,0.2)',
        invert: '#f0ede4',
        invertInk: '#16151a',
    },
};

export default function LayoutPreviewSVG({ kind, variant, theme }: LayoutPreviewSVGProps) {
    const T = TOKENS[theme];

    return (
        <svg viewBox="0 0 320 200" className={s.svg} preserveAspectRatio="xMidYMid meet">
            {/* Background */}
            <rect x="0" y="0" width="320" height="200" fill={T.bg} />

            {/* Chrome: top bar + left rail */}
            <Chrome T={T} kind={kind} />

            {/* Variant content */}
            {kind === 'home' && variant === 'A' && (
                <g>
                    <Calendar T={T} x={20} y={20} w={206} h={56} todayCol={0} />
                    <InboxPanel T={T} x={20} y={82} w={206} h={114} rows={9} dense />
                    <Preview T={T} x={232} y={20} w={82} h={176} />
                </g>
            )}
            {kind === 'home' && variant === 'B' && (
                <g>
                    <InboxPanel T={T} x={20} y={20} w={206} h={176} rows={13} />
                    <Calendar T={T} x={232} y={20} w={82} h={68} todayCol={0} />
                    <Preview T={T} x={232} y={94} w={82} h={102} />
                </g>
            )}
            {kind === 'home' && variant === 'C' && (
                <g>
                    <Calendar T={T} x={20} y={20} w={206} h={176} big todayCol={0} />
                    <InboxPanel T={T} x={232} y={20} w={82} h={176} rows={11} dense />
                </g>
            )}

            {/* Recording: A=雙欄 / B=字幕專注 / C=影片 */}
            {kind === 'recording' && variant === 'A' && (
                <g>
                    {/* slide strip 12 left */}
                    <SlideStrip T={T} x={20} y={20} w={20} h={158} />
                    {/* main slide */}
                    <SlidePanel T={T} x={44} y={20} w={140} h={158} />
                    {/* subtitle stream */}
                    <SubtitlePanel T={T} x={188} y={20} w={126} h={158} />
                    {/* transport bar 60px high */}
                    <TransportBar T={T} x={20} y={182} w={294} />
                </g>
            )}
            {kind === 'recording' && variant === 'B' && (
                <g>
                    {/* subtitle focus full width */}
                    <SubtitlePanel T={T} x={20} y={20} w={264} h={158} focus />
                    {/* slide strip thumbs right 30 */}
                    <SlideStrip T={T} x={288} y={20} w={26} h={158} vertical />
                    <TransportBar T={T} x={20} y={182} w={294} />
                </g>
            )}
            {kind === 'recording' && variant === 'C' && (
                <g>
                    {/* video area */}
                    <VideoPanel T={T} x={20} y={20} w={188} h={140} />
                    {/* subs sidebar */}
                    <SubtitlePanel T={T} x={212} y={20} w={102} h={140} mini />
                    {/* timeline scrubber */}
                    <TimelineScrubber T={T} x={20} y={164} w={294} />
                    <TransportBar T={T} x={20} y={182} w={294} />
                </g>
            )}
        </svg>
    );
}

function Chrome({ T, kind }: { T: Tokens; kind: PreviewKind }) {
    return (
        <>
            {/* Top bar */}
            <rect x="0" y="0" width="320" height="14" fill={T.topbar} />
            <line x1="0" y1="14" x2="320" y2="14" stroke={T.borderSoft} strokeWidth="0.5" />
            <circle cx="6" cy="7" r="1.6" fill="#e8412e" />
            <circle cx="11" cy="7" r="1.6" fill="#f6b24e" />
            <circle cx="16" cy="7" r="1.6" fill="#22c55e" />
            {/* Recording island when on recording preview */}
            {kind === 'recording' && (
                <>
                    <rect x="142" y="3" width="36" height="8" rx="4" fill="#0a0a0a" />
                    <circle cx="148" cy="7" r="1.4" fill="#ff4b4b" />
                </>
            )}

            {/* Left rail */}
            <rect x="0" y="14" width="14" height="186" fill={T.rail} />
            <line x1="14" y1="14" x2="14" y2="200" stroke={T.borderSoft} strokeWidth="0.5" />
            {/* home/notes */}
            <rect x="3" y="20" width="8" height="6" rx="1.5" fill={T.invert} opacity="0.85" />
            <rect x="3" y="29" width="8" height="6" rx="1.5" fill="none" stroke={T.textDim} strokeWidth="0.5" />
            {/* course chips */}
            {COURSE_COLORS.map((c, i) => (
                <rect key={i} x="3" y={42 + i * 11} width="8" height="8" rx="1.5" fill={c} />
            ))}
            {/* + add */}
            <rect x="3" y="100" width="8" height="8" rx="1.5" fill="none" stroke={T.textFaint} strokeWidth="0.5" strokeDasharray="1.5 1" />
            {/* AI + profile */}
            <rect x="3" y="172" width="8" height="6" rx="1.5" fill="none" stroke={T.textDim} strokeWidth="0.5" />
            <circle cx="7" cy="186" r="3.5" fill="#c48a2c" />
        </>
    );
}

interface PanelProps {
    T: Tokens;
    x: number;
    y: number;
    w: number;
    h: number;
}

function Calendar({
    T,
    x,
    y,
    w,
    h,
    todayCol = 0,
    big = false,
}: PanelProps & { todayCol?: number; big?: boolean }) {
    const cols = 7;
    const colW = w / cols;
    const headerH = big ? 12 : 8;
    const events = [
        { col: 0, top: 0.18, h: 0.18, c: 0 },
        { col: 1, top: 0.32, h: 0.14, c: 4 },
        { col: 2, top: 0.5, h: 0.2, c: 1 },
        { col: 3, top: 0.25, h: 0.16, c: 3 },
        { col: 4, top: 0.6, h: 0.18, c: 2 },
        ...(big
            ? [
                  { col: 0, top: 0.55, h: 0.14, c: 4 },
                  { col: 5, top: 0.4, h: 0.18, c: 0 },
                  { col: 6, top: 0.5, h: 0.16, c: 1 },
                  { col: 5, top: 0.7, h: 0.12, c: 3 },
              ]
            : []),
    ];
    return (
        <g>
            <rect x={x} y={y} width={w} height={h} fill={T.surface} stroke={T.borderSoft} strokeWidth="0.5" rx="2" />
            <rect x={x} y={y} width={w} height={headerH} fill={T.surface2} />
            <rect x={x + colW * todayCol} y={y} width={colW} height={h} fill={T.accent} opacity="0.06" />
            {Array.from({ length: cols - 1 }, (_, i) => (
                <line key={i} x1={x + colW * (i + 1)} y1={y} x2={x + colW * (i + 1)} y2={y + h} stroke={T.borderSoft} strokeWidth="0.4" />
            ))}
            <line x1={x} y1={y + headerH} x2={x + w} y2={y + headerH} stroke={T.borderSoft} strokeWidth="0.4" />
            {events.map((e, i) => (
                <rect
                    key={i}
                    x={x + colW * e.col + 1.5}
                    y={y + headerH + (h - headerH) * e.top}
                    width={colW - 3}
                    height={(h - headerH) * e.h}
                    fill={COURSE_COLORS[e.c]}
                    opacity="0.72"
                    rx="1"
                />
            ))}
            {/* now line */}
            <line
                x1={x + colW * todayCol}
                y1={y + headerH + (h - headerH) * 0.45}
                x2={x + colW * (todayCol + 1)}
                y2={y + headerH + (h - headerH) * 0.45}
                stroke={T.accent}
                strokeWidth="0.8"
            />
            <circle cx={x + colW * todayCol + 1} cy={y + headerH + (h - headerH) * 0.45} r="1.2" fill={T.accent} />
        </g>
    );
}

function InboxPanel({
    T,
    x,
    y,
    w,
    h,
    rows = 8,
    dense = false,
}: PanelProps & { rows?: number; dense?: boolean }) {
    const headerH = 10;
    return (
        <g>
            <rect x={x} y={y} width={w} height={h} fill={T.surface} stroke={T.borderSoft} strokeWidth="0.5" rx="2" />
            <rect x={x} y={y} width={w} height={headerH} fill={T.surface2} />
            {[14, 12, 12, 10].map((pw, i) => (
                <rect
                    key={i}
                    x={x + 4 + i * 16}
                    y={y + 3}
                    width={pw}
                    height="4"
                    rx="2"
                    fill={i === 0 ? T.invert : 'none'}
                    stroke={i === 0 ? 'none' : T.borderSoft}
                    strokeWidth="0.4"
                />
            ))}
            {Array.from({ length: rows }, (_, i) => (
                <g key={i}>
                    <circle cx={x + 6} cy={y + headerH + 12 + i * (dense ? 9 : 11)} r="1.3" fill={COURSE_COLORS[i % 5]} />
                    <line
                        x1={x + 11}
                        y1={y + headerH + 12 + i * (dense ? 9 : 11)}
                        x2={x + w - 8}
                        y2={y + headerH + 12 + i * (dense ? 9 : 11)}
                        stroke={T.text}
                        strokeWidth="2"
                        strokeLinecap="round"
                        opacity="0.45"
                    />
                </g>
            ))}
        </g>
    );
}

function Preview({ T, x, y, w, h }: PanelProps) {
    return (
        <g>
            <rect x={x} y={y} width={w} height={h} fill={T.surface} stroke={T.borderSoft} strokeWidth="0.5" rx="2" />
            <rect x={x + 4} y={y + 4} width="22" height="5" fill={T.accent} opacity="0.18" rx="1" />
            <line x1={x + 4} y1={y + 16} x2={x + w - 6} y2={y + 16} stroke={T.text} strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
            <line x1={x + 4} y1={y + 22} x2={x + w - 18} y2={y + 22} stroke={T.text} strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
            <line x1={x + 4} y1={y + 30} x2={x + w - 14} y2={y + 30} stroke={T.textDim} strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
            <rect x={x + 4} y={y + 36} width={w - 8} height="5" fill={T.hotBg} rx="1" />
            <rect x={x + 4} y={y + 46} width={w - 8} height={Math.max(20, h * 0.22)} fill={T.surface2} rx="1.5" />
            {Array.from({ length: 3 }, (_, i) => (
                <rect
                    key={i}
                    x={x + 4}
                    y={y + 46 + Math.max(20, h * 0.22) + 4 + i * 7}
                    width={w - 8}
                    height="5"
                    fill="none"
                    stroke={T.borderSoft}
                    strokeWidth="0.4"
                    rx="1"
                />
            ))}
            <rect x={x + 4} y={y + h - 32} width={w - 8} height="20" fill={T.invert} rx="1.5" />
            <rect x={x + 4} y={y + h - 8} width="18" height="5" fill={T.invert} rx="1" />
            <rect x={x + 24} y={y + h - 8} width="18" height="5" fill="none" stroke={T.borderSoft} strokeWidth="0.4" rx="1" />
        </g>
    );
}

function SlideStrip({
    T,
    x,
    y,
    w,
    h,
    vertical = false,
}: PanelProps & { vertical?: boolean }) {
    const items = 6;
    const itemH = (h - 4) / items - 2;
    return (
        <g>
            <rect x={x} y={y} width={w} height={h} fill={T.surface2} stroke={T.borderSoft} strokeWidth="0.5" rx="2" />
            {Array.from({ length: items }, (_, i) => (
                <rect
                    key={i}
                    x={x + 2}
                    y={y + 2 + i * (itemH + 2)}
                    width={w - 4}
                    height={itemH}
                    fill={T.surface}
                    stroke={i === 2 ? T.accent : T.borderSoft}
                    strokeWidth={i === 2 ? '1' : '0.4'}
                    rx="1"
                    opacity={vertical ? 0.85 : 1}
                />
            ))}
        </g>
    );
}

function SlidePanel({ T, x, y, w, h }: PanelProps) {
    return (
        <g>
            <rect x={x} y={y} width={w} height={h} fill={T.surface} stroke={T.borderSoft} strokeWidth="0.5" rx="2" />
            {/* slide title */}
            <line x1={x + 12} y1={y + 18} x2={x + w * 0.6} y2={y + 18} stroke={T.text} strokeWidth="3" strokeLinecap="round" />
            {/* equation block */}
            <rect x={x + 12} y={y + 36} width={w - 24} height={28} fill={T.surface2} stroke={T.borderSoft} strokeWidth="0.4" rx="2" />
            {/* exam mark */}
            <rect x={x + 12} y={y + 70} width={26} height="6" fill={T.hot} opacity="0.7" rx="1" />
            {/* bullets */}
            {Array.from({ length: 3 }, (_, i) => (
                <line key={i} x1={x + 12} y1={y + 86 + i * 8} x2={x + w - 16} y2={y + 86 + i * 8} stroke={T.textDim} strokeWidth="1.2" opacity="0.5" />
            ))}
        </g>
    );
}

function SubtitlePanel({
    T,
    x,
    y,
    w,
    h,
    focus = false,
    mini = false,
}: PanelProps & { focus?: boolean; mini?: boolean }) {
    const rowH = mini ? 8 : focus ? 22 : 18;
    const rows = Math.floor((h - 12) / rowH);
    return (
        <g>
            <rect x={x} y={y} width={w} height={h} fill={T.surface} stroke={T.borderSoft} strokeWidth="0.5" rx="2" />
            <rect x={x} y={y} width={w} height="8" fill={T.surface2} />
            {Array.from({ length: rows }, (_, i) => {
                const top = y + 12 + i * rowH;
                const isActive = !mini && i === Math.floor(rows / 2);
                return (
                    <g key={i}>
                        {isActive && (
                            <rect
                                x={x + 2}
                                y={top - 2}
                                width={w - 4}
                                height={rowH - 2}
                                fill={T.accent}
                                opacity="0.08"
                                rx="1"
                            />
                        )}
                        <line
                            x1={x + 6}
                            y1={top + 2}
                            x2={x + w - 8}
                            y2={top + 2}
                            stroke={T.text}
                            strokeWidth={focus ? 2.5 : 1.6}
                            strokeLinecap="round"
                            opacity={isActive ? 0.95 : 0.5}
                        />
                        {!mini && (
                            <line
                                x1={x + 6}
                                y1={top + (focus ? 9 : 8)}
                                x2={x + w - 16}
                                y2={top + (focus ? 9 : 8)}
                                stroke={T.textDim}
                                strokeWidth="1.2"
                                strokeLinecap="round"
                                opacity="0.4"
                            />
                        )}
                    </g>
                );
            })}
        </g>
    );
}

function VideoPanel({ T, x, y, w, h }: PanelProps) {
    return (
        <g>
            <rect x={x} y={y} width={w} height={h} fill="#000" rx="2" />
            {/* play triangle */}
            <polygon points={`${x + w / 2 - 8},${y + h / 2 - 8} ${x + w / 2 + 8},${y + h / 2} ${x + w / 2 - 8},${y + h / 2 + 8}`} fill="#fff" opacity="0.5" />
            {/* sub overlay */}
            <rect x={x + 16} y={y + h - 22} width={w - 32} height="14" fill="#0008" rx="1.5" />
            <line x1={x + 22} y1={y + h - 13} x2={x + w - 22} y2={y + h - 13} stroke="#fff" strokeWidth="1.5" opacity="0.85" />
            {/* REC tag */}
            <rect x={x + 6} y={y + 6} width={26} height="8" fill="#000" opacity="0.7" rx="1.5" />
            <circle cx={x + 11} cy={y + 10} r="1.6" fill="#ff4b4b" />
            {void T}
        </g>
    );
}

function TimelineScrubber({ T, x, y, w }: { T: Tokens; x: number; y: number; w: number }) {
    return (
        <g>
            <rect x={x} y={y} width={w} height="14" fill={T.surface2} rx="2" />
            <rect x={x + 2} y={y + 4} width={w * 0.42} height="6" fill={T.accent} opacity="0.3" rx="1" />
            {/* sub markers */}
            {Array.from({ length: 9 }, (_, i) => (
                <rect
                    key={i}
                    x={x + 12 + i * (w - 24) / 9}
                    y={y + 3}
                    width="1.2"
                    height="8"
                    fill={i % 4 === 0 ? T.hot : T.textDim}
                    opacity="0.7"
                />
            ))}
            <rect x={x + w * 0.42} y={y} width="1.5" height="14" fill={T.accent} />
        </g>
    );
}

function TransportBar({ T, x, y, w }: { T: Tokens; x: number; y: number; w: number }) {
    return (
        <g>
            <rect x={x} y={y} width={w} height="14" fill={T.surface2} stroke={T.borderSoft} strokeWidth="0.5" rx="2" />
            {/* rec dot + time */}
            <circle cx={x + 6} cy={y + 7} r="2" fill="#ff3b30" />
            <line x1={x + 12} y1={y + 7} x2={x + 28} y2={y + 7} stroke={T.text} strokeWidth="3" strokeLinecap="round" />
            {/* pause button */}
            <rect x={x + 36} y={y + 3} width={20} height="8" fill={T.invert} rx="1.5" />
            {/* follow toggle */}
            <rect x={x + 60} y={y + 3} width={26} height="8" fill="none" stroke={T.accent} strokeWidth="0.6" rx="1.5" />
            {/* exam mark */}
            <rect x={x + 90} y={y + 3} width={28} height="8" fill="none" stroke={T.borderSoft} strokeWidth="0.5" rx="1.5" />
            {/* finish 結束 right side */}
            <rect x={x + w - 38} y={y + 3} width={32} height="8" fill="#e8412e" rx="1.5" />
        </g>
    );
}
