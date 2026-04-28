/**
 * Global console wrapper · Phase 7 W19
 *
 * Wraps `console.log/info/warn/error/debug` so that any output (DevTools,
 * piped stdout in dev) is run through the same redact pass we already
 * apply to support-bundle exports.
 *
 * Redaction patterns (subset):
 *   - sk-ant-, sk- (Anthropic / OpenAI keys)
 *   - Bearer xxx (auth headers)
 *   - api[_-]?key=xxx
 *   - Long base64 strings 40+ chars (often tokens)
 *
 * Call `installConsoleRedaction()` once at boot. Idempotent.
 */

export interface ConsoleRedactionOptions {
    /** patterns to scrub (replaces with `[REDACTED]`). 預設見 DEFAULT_PATTERNS。 */
    patterns?: RegExp[];
    /**
     * 是否在每次 redact 時保留原值在 sessionStorage 裡（debug 用，預設 false）。
     * 留作 future hook；目前未啟用以避免額外 IO。
     */
    preserveOriginal?: boolean;
}

/**
 * Default redaction patterns. ORDER MATTERS — the more-specific keyed patterns
 * (api_key= / token= / etc.) run BEFORE the bare sk-/Bearer scrubs so the
 * field name is preserved and JSON deep-redaction stays parseable.
 *
 * The keyed pattern uses two capture groups so the replacement can keep
 * `<keyname><separator>` and only swap the secret tail — otherwise the field
 * name itself would be eaten and JSON.parse would explode in redactArg().
 */
export const DEFAULT_PATTERNS: RegExp[] = [
    /(api[_-]?key|token|secret|password|authorization)(["'\s:=]+)[^\s"']{10,}/gi,
    /sk-ant-[A-Za-z0-9_-]{20,}/g,                   // Anthropic API key
    /sk-[A-Za-z0-9]{20,}/g,                         // OpenAI / 通用 sk- key
    /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,           // Bearer token
    // 注意: 不過濾 short 字串避免 false positive (e.g. status code, version)
];

const REDACTION_PLACEHOLDER = '[REDACTED]';
// Patterns whose first two capture groups must be preserved (key + separator).
const KEYED_PATTERNS = new Set<RegExp>([DEFAULT_PATTERNS[0]]);

export function redactString(s: string, patterns: RegExp[] = DEFAULT_PATTERNS): string {
    let out = s;
    for (const p of patterns) {
        // Reset lastIndex on global regex to avoid stateful surprises across calls.
        if (p.global) p.lastIndex = 0;
        if (KEYED_PATTERNS.has(p)) {
            // Preserve `<key><separator>` so e.g. JSON keys are not eaten.
            out = out.replace(p, `$1$2${REDACTION_PLACEHOLDER}`);
        } else {
            out = out.replace(p, REDACTION_PLACEHOLDER);
        }
    }
    return out;
}

export function redactArg(arg: unknown, patterns: RegExp[] = DEFAULT_PATTERNS): unknown {
    if (typeof arg === 'string') return redactString(arg, patterns);
    if (arg instanceof Error) return arg; // 不 redact Error stack（避免破 source map）
    if (arg && typeof arg === 'object') {
        try {
            const json = JSON.stringify(arg);
            if (json === undefined) return arg;
            const redacted = redactString(json, patterns);
            // 若沒變化直接回原物件（保留 reference identity）
            if (redacted === json) return arg;
            return JSON.parse(redacted);
        } catch {
            return arg; // circular ref 等 → 不動
        }
    }
    return arg;
}

let installed = false;
let originalConsole: Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug'> | null = null;

export function installConsoleRedaction(opts: ConsoleRedactionOptions = {}): void {
    if (installed) return;
    installed = true;
    const patterns = opts.patterns ?? DEFAULT_PATTERNS;
    originalConsole = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        debug: console.debug.bind(console),
    };
    (['log', 'info', 'warn', 'error', 'debug'] as const).forEach((m) => {
        console[m] = (...args: unknown[]) => {
            const safe = args.map((a) => redactArg(a, patterns));
            originalConsole![m](...safe);
        };
    });
}

export function uninstallConsoleRedaction(): void {
    if (!installed || !originalConsole) return;
    Object.assign(console, originalConsole);
    installed = false;
    originalConsole = null;
}

/** TEST-ONLY 取得目前 install 狀態 */
export function __isInstalled(): boolean {
    return installed;
}
