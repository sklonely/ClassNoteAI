# Agent CLI

The agent CLI is the first stable command surface for automated debugging and
smoke testing. It gives humans, CI, and sub-agents a machine-readable way to ask
"what can this checkout do?", "is the app bridge available?", and "does the local
smoke profile pass?" without relying on WebView remote debugging.

## Commands

Run from `ClassNoteAI/`:

```bash
npm run agent:handshake
npm run agent:smoke
```

Direct form:

```bash
node scripts/cnai-agent.mjs handshake --json
node scripts/cnai-agent.mjs app launch --dev --detach --json
node scripts/cnai-agent.mjs app attach --json
node scripts/cnai-agent.mjs app status --json
node scripts/cnai-agent.mjs app handshake --json --bridge-url http://127.0.0.1:4317
node scripts/cnai-agent.mjs events watch --ndjson --bridge-url http://127.0.0.1:4317
node scripts/cnai-agent.mjs events watch --follow --ndjson --max-events 10
node scripts/cnai-agent.mjs tasks list --json
node scripts/cnai-agent.mjs logs tail --json --bridge-url http://127.0.0.1:4317
node scripts/cnai-agent.mjs diag bundle --json
node scripts/cnai-agent.mjs workflow list --json
node scripts/cnai-agent.mjs workflow diagnostics --json
node scripts/cnai-agent.mjs call raw get_build_features --json
node scripts/cnai-agent.mjs ui tree --json
node scripts/cnai-agent.mjs ui click --target nav.settings --json
node scripts/cnai-agent.mjs ui wait-for --target view.settings --json
node scripts/cnai-agent.mjs ui type --target course.name --text "Algorithms" --clear --json
node scripts/cnai-agent.mjs ui key --key Escape --json
node scripts/cnai-agent.mjs ui navigate --path / --json
node scripts/cnai-agent.mjs smoke --profile quick --json
node scripts/cnai-agent.mjs smoke --profile frontend --ndjson
node scripts/cnai-agent.mjs smoke --profile release --json
```

## Output Contract

`--json` prints a single final JSON object to stdout. Step logs are written to
stderr so another agent can parse stdout safely.

`--ndjson` prints one JSON event per line to stdout. This is the preferred mode
for long-running agent sessions because a parent agent can stream progress
without waiting for the final result.

All payloads include `schemaVersion: 1`.

## Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | The command completed successfully. |
| `1` | A smoke step failed or timed out. |
| `2` | Usage error or internal CLI error. |
| `3` | The requested command needs the app bridge, but the bridge is unavailable. |

## Requirement Coverage

Issue #112 is larger than this first CLI PR. This table keeps the scope honest:

| Original CLI / bridge requirement | Current status |
| --- | --- |
| Versioned machine-readable CLI handshake | Implemented by `handshake --json`. |
| Machine-readable progress output | Implemented for smoke profiles via `--json` / `--ndjson`. |
| Explicit exit codes | Implemented, including bridge-unavailable code `3`. |
| Capability discovery | Implemented for CLI capabilities and planned workflow contracts. |
| App launch / attach / authenticated local bridge | Implemented behind opt-in `CNAI_AGENT_BRIDGE=1`; `app launch` starts dev mode with the bridge, `app attach` reads the attach file, and app-backed commands send bearer auth. |
| App status | Implemented through `/v1/status`. |
| Log tail | Implemented through `/v1/logs` for recent logs. Continuous follow is part of the command contract but currently returns the current log snapshot. |
| Structured event streaming | Implemented through `/v1/events`; add `?follow=1` or CLI `events watch --follow --ndjson` for a long-lived stream. |
| Task lifecycle records | Implemented through `/v1/tasks` and `tasks list`; bridge-backed workflows/actions emit `task.started` and terminal task events. |
| Diagnostic bundle | Implemented locally and through `/v1/diag/bundle` when attached to the app bridge. |
| Raw command plane | Implemented for a small safe allowlist: `get_build_features` and `agent_bridge_status`. |
| High-level workflow commands | `workflow list` exposes contracts locally and through `/v1/workflows`; `workflow diagnostics` is implemented as an app-backed workflow. Media/OCR/summary/chat execution endpoints currently return structured `unsupported`. |
| Visual snapshot / semantic UI tree | `ui tree` and `ui snapshot` now return renderer DOM state when the app is attached, with native window inventory as fallback. Pixel screenshots remain a later bridge phase. |
| UI action plane | Implemented for renderer `click`, `type`, `key`, `navigate`, and `wait-for` actions through authenticated bridge endpoints. |
| Cross-platform app smoke | Local CLI smoke is cross-platform; real CLI-to-running-app smoke is available through `app launch` + `app status`, and should be added to CI/manual release smoke once stable on both OSes. |

## Smoke Profiles

| Profile | Steps | Intended Use |
| --- | --- | --- |
| `quick` | `tsc --noEmit` | Fast sub-agent sanity check before handing work back. |
| `frontend` | `tsc --noEmit`, `vitest run` | Normal frontend regression check. |
| `release` | `vitest run`, `npm run build` | Mirrors the frontend gate used before release bundling. |

## Bridge Roadmap

This CLI can attach to a desktop app that was started with the agent bridge
enabled. The bridge is opt-in so normal users do not expose a localhost control
surface.

```bash
CNAI_AGENT_BRIDGE=1 npm run tauri -- dev
node scripts/cnai-agent.mjs app attach --json
node scripts/cnai-agent.mjs app status --json
```

The first bridge-backed version provides:

- versioned handshake
- machine-readable output
- deterministic smoke profiles
- explicit exit codes
- progress streaming through NDJSON
- bridge-aware commands that fail with structured `bridge_unavailable` payloads
- authenticated attach via an app-written attach file
- status, logs, events, diagnostic bundle, and workflow discovery endpoints
- renderer DOM state and basic UI actions for app-driving agents
- task lifecycle records and long-lived event follow mode for action/workflow correlation

The next bridge-backed commands should reuse this entry point:

```bash
node scripts/cnai-agent.mjs app status --json
node scripts/cnai-agent.mjs ui tree --json
node scripts/cnai-agent.mjs ui click --target nav.settings --json
node scripts/cnai-agent.mjs ui wait-for --target view.settings --json
node scripts/cnai-agent.mjs events watch --follow --ndjson
node scripts/cnai-agent.mjs tasks list --json
node scripts/cnai-agent.mjs workflow import-media --file lecture.mp4 --json
node scripts/cnai-agent.mjs diag bundle --json
```

That keeps sub-agents on one stable CLI channel while the app bridge grows
behind it.
