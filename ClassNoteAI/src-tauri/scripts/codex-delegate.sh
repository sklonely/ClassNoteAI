#!/usr/bin/env bash
# codex-delegate.sh — robust wrapper around `codex exec` for commander/worker
# delegation. Designed for when Claude Code (the commander) hands a well-
# scoped subtask to Codex (the worker) to save commander-side tokens.
#
# Why this exists: plain `codex exec` has reliability issues that kept
# biting during the v0.6.0 smoke test round:
#
#   1. OpenAI backend disconnects mid-run. Codex logs
#      `Re-connecting... 1/5 ... 5/5` and hangs indefinitely.
#   2. Silent API hang — codex child process stays alive at 0% CPU
#      with the HTTP request never returning a byte. No reconnect
#      lines, no progress, just a dead socket.
#   3. No wallclock or idle limit. A hung run burns commander polling
#      budget without producing a diff.
#
# This wrapper:
#   * Hard wallclock timeout (default 900s; --timeout).
#   * **Idle timeout** (default 120s; --idle-timeout): if the log file
#     stops growing for N seconds, treat as hang and kill/retry. This
#     catches the silent-hang case that wallclock misses.
#   * Heartbeat file at /tmp/codex-heartbeat-<pid>.txt. Injects a
#     preamble into the prompt telling Codex to write its first step
#     there, then update it as it progresses. Commander can tail this
#     externally to observe liveness independent of stdout buffering.
#   * Retries up to N times (default 2; --retries) on wallclock OR
#     idle OR reconnect-loop OR non-zero exit.
#   * Kills orphan `codex.exe` children on retry.
#   * `model_reasoning_effort=high` via CLI -c override (beats invalid
#     ~/.codex/config.toml values).
#   * Dumps last 40 log lines on final failure.
#
# Usage:
#   codex-delegate.sh [--timeout SEC] [--idle-timeout SEC] [--retries N]
#                     [--prompt-file PATH | PROMPT_STRING]
#
# Examples:
#   codex-delegate.sh "Fix B8 — wrap JSON.parse calls in try/catch"
#   codex-delegate.sh --timeout 1200 --idle-timeout 180 --retries 3 \
#       --prompt-file /tmp/big-task.md

set -u

TIMEOUT=900
IDLE_TIMEOUT=120
RETRIES=2
PROMPT=""
PROMPT_FILE=""

while [ $# -gt 0 ]; do
    case "$1" in
        --timeout)       TIMEOUT="$2"; shift 2 ;;
        --idle-timeout)  IDLE_TIMEOUT="$2"; shift 2 ;;
        --retries)       RETRIES="$2"; shift 2 ;;
        --prompt-file)   PROMPT_FILE="$2"; shift 2 ;;
        --)              shift; PROMPT="$*"; break ;;
        *)               PROMPT="${PROMPT}${PROMPT:+ }$1"; shift ;;
    esac
done

if [ -n "$PROMPT_FILE" ]; then
    if [ ! -f "$PROMPT_FILE" ]; then
        echo "[codex-delegate] ERROR: prompt file not found: $PROMPT_FILE" >&2
        exit 2
    fi
    PROMPT=$(cat "$PROMPT_FILE")
fi

if [ -z "$PROMPT" ]; then
    echo "Usage: $0 [--timeout SEC] [--idle-timeout SEC] [--retries N] [--prompt-file PATH | PROMPT]" >&2
    exit 2
fi

if ! command -v codex >/dev/null 2>&1; then
    echo "[codex-delegate] ERROR: codex not on PATH (install via npm / scoop)" >&2
    exit 2
fi

LOG=$(mktemp -t codex-delegate-XXXXXX.log)
HEARTBEAT=$(mktemp -t codex-heartbeat-XXXXXX.txt)
trap 'rm -f "$LOG" "$HEARTBEAT"' EXIT

echo "[codex-delegate] heartbeat: $HEARTBEAT" >&2
echo "[codex-delegate] log:       $LOG" >&2

kill_orphan_codex() {
    if command -v taskkill >/dev/null 2>&1; then
        taskkill //F //IM codex.exe >/dev/null 2>&1 || true
    else
        pkill -f "codex exec" 2>/dev/null || true
    fi
}

# Prepend a preamble instructing Codex to emit a heartbeat. The path
# is baked in so we can stat it externally for liveness.
build_full_prompt() {
    cat <<PREAMBLE
BEFORE DOING ANYTHING ELSE: write one line describing your current step
to the file "$HEARTBEAT" (overwriting prior contents). Update it every
time you finish reading a file, start an edit, or finish an edit.
Format: "[HH:MM:SS] <what you just did or are about to do>"
This heartbeat is how the commander knows you are alive. A stale file
(no update for 2 minutes) will be treated as a hang and your run will
be killed.

--- TASK ---
PREAMBLE
    printf '%s\n' "$PROMPT"
}

# Watch the log file's mtime. Kill the codex subprocess group if no
# growth for IDLE_TIMEOUT seconds. Exit 0 on healthy termination of
# $target_pid; exit 2 on idle kill.
watch_idle() {
    local target_pid="$1"
    local last_size=0
    local idle_start
    idle_start=$(date +%s)
    while kill -0 "$target_pid" 2>/dev/null; do
        sleep 10
        local cur_size
        cur_size=$(stat -c %s "$LOG" 2>/dev/null || stat -f %z "$LOG" 2>/dev/null || echo 0)
        local hb_size=0
        [ -f "$HEARTBEAT" ] && hb_size=$(stat -c %s "$HEARTBEAT" 2>/dev/null || stat -f %z "$HEARTBEAT" 2>/dev/null || echo 0)
        local combined=$((cur_size + hb_size))
        if [ "$combined" -gt "$last_size" ]; then
            last_size=$combined
            idle_start=$(date +%s)
            continue
        fi
        local idle_elapsed=$(( $(date +%s) - idle_start ))
        if [ "$idle_elapsed" -ge "$IDLE_TIMEOUT" ]; then
            echo "[codex-delegate] IDLE ${idle_elapsed}s — killing codex" >&2
            kill_orphan_codex
            return 2
        fi
    done
    return 0
}

run_one_attempt() {
    local attempt="$1"
    echo "[codex-delegate] attempt $attempt (wallclock ${TIMEOUT}s, idle ${IDLE_TIMEOUT}s, reasoning=high)" >&2
    local prompt_tmp
    prompt_tmp=$(mktemp -t codex-prompt-XXXXXX.txt)
    build_full_prompt > "$prompt_tmp"
    : > "$LOG"
    : > "$HEARTBEAT"

    timeout --kill-after=15 "$TIMEOUT" \
        codex exec \
            -c 'model_reasoning_effort="high"' \
            --skip-git-repo-check \
            --sandbox workspace-write \
            "$(cat "$prompt_tmp")" \
        > "$LOG" 2>&1 &
    local codex_pid=$!

    watch_idle "$codex_pid" &
    local watch_pid=$!

    wait "$codex_pid"
    local rc=$?
    # Clean up the idle watcher if codex finished naturally.
    kill "$watch_pid" 2>/dev/null
    wait "$watch_pid" 2>/dev/null
    rm -f "$prompt_tmp"

    local reconn_count
    reconn_count=$(grep -c "Re-connecting\.\.\." "$LOG" 2>/dev/null | head -1)
    reconn_count=${reconn_count:-0}

    if [ "$rc" -eq 0 ] && [ "$reconn_count" -lt 3 ]; then
        return 0
    fi

    case "$rc" in
        124|137) echo "[codex-delegate] attempt $attempt WALLCLOCK TIMEOUT (rc=$rc) — killing orphans" >&2; kill_orphan_codex ;;
        143)     echo "[codex-delegate] attempt $attempt IDLE KILLED (rc=$rc)" >&2; kill_orphan_codex ;;
        *)       echo "[codex-delegate] attempt $attempt failed (rc=$rc, reconnects=$reconn_count)" >&2 ;;
    esac
    return 1
}

overall_start=$(date +%s)
for attempt in $(seq 1 $((RETRIES + 1))); do
    if run_one_attempt "$attempt"; then
        elapsed=$(( $(date +%s) - overall_start ))
        echo "[codex-delegate] SUCCESS in ${elapsed}s on attempt $attempt" >&2
        cat "$LOG"
        exit 0
    fi
    [ "$attempt" -le "$RETRIES" ] && sleep 10
done

echo "[codex-delegate] FAILED after $((RETRIES + 1)) attempts" >&2
echo "--- last 40 log lines ---" >&2
tail -40 "$LOG" >&2
echo "--- last heartbeat ---" >&2
cat "$HEARTBEAT" >&2 2>/dev/null || echo "(empty)" >&2
exit 1
