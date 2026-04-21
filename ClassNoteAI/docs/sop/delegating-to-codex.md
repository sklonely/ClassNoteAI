# Delegating tasks to Codex as the commander's worker

Claude Code (commander) → Codex (worker) delegation pattern. Saves
commander-side tokens by handing off well-scoped subtasks to a second
AI running under the user's ChatGPT Plus quota.

## Preferred path: `codex:rescue` subagent

The Codex Claude Code plugin exposes a `codex:codex-rescue` subagent.
That is the primary delegation path:

```
Agent(subagent_type="codex:codex-rescue", prompt="<preamble + task body>")
```

The plugin shares a Codex runtime across delegations, handles OAuth
(via `auth.json`), and survives backend reconnects. Parallel
delegations work — the commander can fan out 3+ tasks to different
files in one message and collect the results.

Keep `src-tauri/scripts/codex-delegate.sh` as a headless fallback
(cron, CI, non-Claude-Code shells). See its header comment for usage.

## When to delegate (and when not to)

### ✅ Worth delegating

- **Single-file fixes with a clear recipe**: wrap N parse calls,
  retry one call site, replace hardcoded version with a discovery
  loop. Codex respects literal numbered constraints well.
- **Uniform boilerplate**: add error handling / logging / docstrings
  to a module consistently.
- **Long-running read + audit**: "find every `unwrap()` in these
  crates and fix the ones on fallible IO paths."
- **Parallelizable work** the commander wants to interleave with its
  own thinking.

### ❌ Not worth it

- **1-2 line fixes**: prompt-writing overhead > the edit itself.
- **Tasks needing commander-specific tools**: CDP eval, Monitor,
  `gh run view`, existing Bash sessions, editor state. Codex
  starts from scratch each time.
- **Interactive judgment**: "figure out what to do here." Scope the
  decision yourself, then hand Codex a concrete plan.
- **Commander-side prompt > ~1k tokens**: you've already paid most
  of the thinking cost; finish the task yourself.

## Prompt structure: universal preamble + task body

Every delegation should have two parts. The preamble is **reusable
verbatim** across all tasks; the body is minimal — just the
task-specific facts.

### Universal preamble (paste as-is)

```
## Delegation protocol for this task

### Scope constraints — numbered, literal, non-negotiable
1. Edit only the target file(s) listed in the task body. No other files.
2. Do not commit. Do not `git add`. Do not push.
3. Do not reformat lines that aren't part of the fix. No `cargo fmt`,
   `prettier`, `eslint --fix`, `rustfmt`, `black`, `gofmt`, or equivalent.
4. Do not add new crate / package dependencies.
5. Do not add new `use` / `import` / `require` statements unless
   strictly necessary. Prefer fully-qualified paths (e.g.
   `std::fs::read_dir`, `std::thread::sleep`).
6. Do not change public function signatures, exported types, or
   non-target code paths.

### Non-ASCII byte preservation — critical
Many files in this repo contain CJK (Chinese/Japanese/Korean)
characters in comments, docstrings, log messages, and string
literals. Some patch tools round-trip bytes through a non-UTF-8
codec on Windows, which silently corrupts those characters —
they mojibake into sequences like `?`, `�`, `撠`, `摮`, `銝`,
`脰`, `澆`, or interleaved `?`-runs.

After generating your patch:
1. Scan your own output diff for `?`-runs that replaced CJK text,
   for `�` (U+FFFD), or for unexpected `-` lines on context
   bytes you did not intend to touch.
2. If any of the above appear, the edit is broken — retry or
   report the problem. Do not ship a corrupted patch.
3. Preserve every non-ASCII byte byte-for-byte in regions you
   are not deliberately rewriting.

### Verify semantics — do not misinterpret
Run the verify command listed in the task body and report what you
see. The commander re-verifies locally regardless.

Success = NO output lines begin with `error:` (Rust / cargo) or
contain `error TS` (TypeScript / tsc), or whatever hard-error
marker the tool uses.

These are NOT failures and must be IGNORED:
- `warning:` / `warning TS` lines (pre-existing noise)
- Silent exit on clean (tsc, prettier --check, rustfmt --check)
- `--quiet` flag suppressing normal build output
- Sandbox `os error 5` / access-denied to `target/`, `node_modules/`,
  `dist/`, `.next/` — an environment limitation of the Codex
  sandbox, not a code defect. Note it in your summary and stop.

Only `error:` / `error TS` lines count as real failure.

### Behaviour contracts — preserve unless explicitly asked to change
User-visible strings carry meaning the commander relies on: error
messages, log messages, download URLs, i18n copy, CLI output, version
strings, help text. Treat them as part of the public contract:
- If the task body gives a new exact string, use it verbatim.
- If the task body does NOT mention a user-visible string, preserve
  the existing text semantically: do not shorten, condense, drop URLs,
  drop secondary-language copy, or "tidy up" the wording.
- If you must produce a new string not prescribed by the body, carry
  every piece of information the old string held (URLs, paths,
  version numbers, bilingual copy).

Observability contracts: when a fix adds a retry, fallback, or
recovery loop, every branch of that loop must emit equivalent
log/trace evidence. If the last attempt in a retry chain fails,
log it — commander debugging relies on having a line per attempt.

### Touching adjacent lines when strictly required
Constraint #6 ("do not change non-target code paths") sometimes
collides with correctness: introducing a new nullable value may force
a downstream access to become null-safe, or adding a new Result arm
may require the match below to add a case. When an adjacent-line
change is strictly necessary to prevent a runtime or compile failure,
make the change AND call it out in the self-report below as point 4.
Do not use this as an excuse to reformat. The bar is: "without this
edit, the fix introduces a runtime crash or compile error." If the
existing adjacent line still works with your new value, leave it.

### Self-report contract
Your final sentence(s) must state explicitly:
1. Which file(s) you edited. Confirm no others were touched.
2. What verify command you ran and whether any `error:`-class lines
   appeared (and if the sandbox blocked the verify, say so).
3. That you scanned your patch for CJK byte corruption per the
   preamble — and either found none, or found and fixed it.
4. Any user-visible strings you modified and any adjacent lines you
   touched per the rules above, each with a one-sentence justification.
   (Omit if none.)

The commander treats your self-report as a hint, not ground truth.
Be honest about what you did and did not check.
```

### Task body (minimal — facts only)

```
## Task

Target: <absolute path(s)>
Function / section: <name + approximate line range>

Current state: <1-3 sentence description, or a literal code quote
if the location is ambiguous>

Problem: <1-2 sentences on the symptom + impact>

Desired behaviour: <numbered steps, concrete; NO prose like "improve
the error handling" — Codex wanders on vague goals>

Rough shape (if the algorithm is non-obvious):
<example code block — Codex adapts this to the file's style, so it
is load-bearing for correctness>

Edge cases to handle: <bullets, by principle not specific example
where possible — e.g. "version-like strings must not be compared
lexicographically since multi-digit fields break ASCII order">

Verify: <exact command + cwd>
```

## Commander responsibilities after Codex returns

Regardless of what Codex self-reports:

1. `git status --short` — only the expected paths modified?
2. `git diff -- <paths>` — changes make semantic sense? Spot-check
   for accidental encoding corruption even if Codex claimed to check.
3. Run verify command locally — sandbox often blocks it on Codex
   side, and "compiles cleanly" is not the same as "behaves
   correctly."
4. For CJK-heavy files: explicitly `grep` for the preserved
   comments / strings you expect to see unchanged.
5. Commit with both co-author trailers:
   ```
   Co-Authored-By: OpenAI Codex <codex@openai.com>
   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   ```

## Budget model

Per delegation (single-file fix, ~200-line function change):
- ChatGPT side: 10-15k tokens (one reasoning pass + a few tool calls)
- Commander side: ~1-2k tokens writing the prompt (preamble reused
  verbatim is free), plus ~1k tokens reviewing the diff

Net commander savings: ~10× vs doing the full read+write+verify cycle
yourself. Parallelize independent tasks — the plugin handles fan-out.

Skip delegating if the task-body facts alone exceed ~1k tokens —
you've paid most of the thinking cost already.

## Known failure modes and mitigations

| Symptom | Mitigation |
|---|---|
| Codex interprets `cargo check --quiet` warnings as errors | Preamble's "Verify semantics" block defines `error:` as the only real failure marker |
| CJK comment mojibakes during apply_patch | Preamble requires self-scan; commander regreps expected Chinese strings after |
| Codex's sandbox blocks verify with `os error 5` | Preamble allow-lists this; commander re-verifies locally |
| Lexicographic sort on version-like strings breaks at multi-digit | Call out the principle in task-body edge cases — Codex then picks mtime or semver parse |
| Codex picks "improvement" that changes caller contract silently | Commander spot-checks behaviour change against known callers via grep |

## Anti-patterns to avoid

- **Prose-only prompts** ("please clean up the error handling"):
  Codex wanders. Always numbered, always literal.
- **Single combined "Run cargo check AND run the tests AND..."
  verify step**: Codex reports the first failure it sees; subsequent
  signals get lost.
- **Skipping the commander-side diff review**: Codex's self-report
  is optimistic by training. Always verify locally.
- **Delegating while the commander's working directory has unrelated
  dirty changes**: Codex may touch them. `git status` before and
  after every delegation.
