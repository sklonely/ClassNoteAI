#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');
const PACKAGE_JSON = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, 'package.json'), 'utf8'),
);

const CLI_VERSION = '0.1.0';
const DEFAULT_BRIDGE_URL = process.env.CNAI_AGENT_BRIDGE_URL ?? '';
const DEFAULT_BRIDGE_TOKEN = process.env.CNAI_AGENT_BRIDGE_TOKEN ?? '';
const DEFAULT_ATTACH_FILE =
  process.env.CNAI_AGENT_ATTACH_FILE ?? resolve(appDataDir(), 'agent-bridge.json');
const PROFILES = {
  quick: [
    {
      id: 'typecheck',
      command: npmExec(),
      args: ['exec', 'tsc', '--', '--noEmit'],
      timeoutMs: 120_000,
    },
  ],
  frontend: [
    {
      id: 'typecheck',
      command: npmExec(),
      args: ['exec', 'tsc', '--', '--noEmit'],
      timeoutMs: 120_000,
    },
    {
      id: 'vitest',
      command: npmExec(),
      args: ['exec', 'vitest', '--', 'run'],
      timeoutMs: 180_000,
    },
  ],
  release: [
    {
      id: 'vitest',
      command: npmExec(),
      args: ['exec', 'vitest', '--', 'run'],
      timeoutMs: 180_000,
    },
    {
      id: 'build',
      command: npmExec(),
      args: ['run', 'build'],
      timeoutMs: 240_000,
    },
  ],
};

function npmExec() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function appDataDir() {
  if (process.platform === 'win32') {
    return resolve(process.env.APPDATA ?? homedir(), 'com.classnoteai');
  }
  if (process.platform === 'darwin') {
    return resolve(homedir(), 'Library', 'Application Support', 'com.classnoteai');
  }
  return resolve(process.env.XDG_DATA_HOME ?? resolve(homedir(), '.local', 'share'), 'com.classnoteai');
}

function nowIso() {
  return new Date().toISOString();
}

function usage() {
  return `ClassNoteAI agent CLI

Usage:
  node scripts/cnai-agent.mjs handshake [--json]
  node scripts/cnai-agent.mjs app launch [--json] [--dev] [--detach] [--port N]
  node scripts/cnai-agent.mjs app attach [--json] [--attach-file PATH]
  node scripts/cnai-agent.mjs app handshake [--json] [--bridge-url URL] [--token TOKEN]
  node scripts/cnai-agent.mjs app status [--json] [--bridge-url URL] [--token TOKEN]
  node scripts/cnai-agent.mjs app ai-status [--json] [--bridge-url URL] [--token TOKEN]
  node scripts/cnai-agent.mjs events watch [--ndjson] [--follow] [--max-events N] [--bridge-url URL] [--token TOKEN]
  node scripts/cnai-agent.mjs tasks list [--json] [--bridge-url URL] [--token TOKEN]
  node scripts/cnai-agent.mjs logs tail [--json] [--follow] [--bridge-url URL] [--token TOKEN]
  node scripts/cnai-agent.mjs diag bundle [--json] [--output PATH]
  node scripts/cnai-agent.mjs workflow list [--json]
  node scripts/cnai-agent.mjs workflow import-media --json --lecture-id ID --file PATH [--language auto|en|zh] [--dry-run]
  node scripts/cnai-agent.mjs workflow ocr-index --json --lecture-id ID [--pdf-path PATH] [--transcript-text TEXT] [--force-refresh] [--dry-run]
  node scripts/cnai-agent.mjs workflow summarize --json [--lecture-id ID|--content TEXT] [--language zh|en] [--write-note] [--dry-run]
  node scripts/cnai-agent.mjs ui snapshot [--json]
  node scripts/cnai-agent.mjs ui tree [--json]
  node scripts/cnai-agent.mjs ui click --target ID [--json]
  node scripts/cnai-agent.mjs ui type --target ID --text TEXT [--clear] [--json]
  node scripts/cnai-agent.mjs ui key --key KEY [--json]
  node scripts/cnai-agent.mjs ui navigate --path PATH [--json]
  node scripts/cnai-agent.mjs ui wait-for [--target ID|--selector CSS|--text TEXT] [--timeout-ms N] [--json]
  node scripts/cnai-agent.mjs call raw <command> [--json]
  node scripts/cnai-agent.mjs smoke [--profile quick|frontend|release|app-bridge] [--json|--ndjson] [--dry-run] [--launch-app] [--keep-app] [--timeout-ms N]

Commands:
  handshake       Print the machine-readable CLI capability contract.
  app launch      Launch the desktop app with the agent bridge enabled.
  app attach      Read the app bridge attach file.
  app handshake   Ask a running app bridge for its versioned contract.
  app status      Ask a running app bridge for app/session health.
  app ai-status   Ask a running app bridge for AI provider readiness.
  events watch    Stream app bridge events as NDJSON.
  tasks list      List bridge task lifecycle records.
  logs tail       Read or follow app bridge logs.
  diag bundle     Write a local CLI diagnostic bundle.
  workflow list   Print known workflow command contracts.
  ui snapshot     Ask the app bridge for a visual snapshot.
  ui tree         Ask the app bridge for a semantic UI tree.
  ui click        Click a renderer UI element by stable id or selector.
  ui type         Type text into an input/textarea/contenteditable target.
  ui key          Send a keyboard event to the focused element.
  ui navigate     Push a renderer route/path.
  ui wait-for     Wait until text or a target appears in the renderer UI.
  call raw        Ask the bridge to invoke a raw app command.
  smoke           Run a deterministic local smoke profile for agents/CI.

Output:
  --json      Print one final JSON object to stdout. Step logs go to stderr.
  --ndjson    Print one JSON event per line to stdout.
`;
}

function parseArgs(argv) {
  const args = [...argv];
  let command = args.shift();
  if (['app', 'events', 'tasks', 'logs', 'diag', 'workflow', 'ui', 'call'].includes(command)) {
    const subcommand = args.shift();
    if (!subcommand || subcommand.startsWith('-')) {
      throw new UsageError(`Missing subcommand for: ${command}`);
    }
    command = `${command}:${subcommand}`;
  }
  const options = {
    command,
    format: 'human',
    profile: 'quick',
    dryRun: false,
    timeoutMs: undefined,
    bridgeUrl: DEFAULT_BRIDGE_URL,
    token: DEFAULT_BRIDGE_TOKEN,
    attachFile: DEFAULT_ATTACH_FILE,
    output: undefined,
    follow: false,
    launchApp: false,
    keepApp: false,
    detach: false,
    dev: false,
    port: undefined,
    file: undefined,
    lectureId: undefined,
    courseId: undefined,
    noteId: undefined,
    pdfPath: undefined,
    transcriptText: undefined,
    content: undefined,
    language: undefined,
    forceRefresh: false,
    writeNote: undefined,
    maxEvents: undefined,
    target: undefined,
    selector: undefined,
    text: undefined,
    path: undefined,
    key: undefined,
    clear: false,
    positional: [],
  };

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--json') {
      options.format = 'json';
    } else if (arg === '--ndjson') {
      options.format = 'ndjson';
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--profile') {
      options.profile = args.shift();
    } else if (arg === '--timeout-ms') {
      const raw = args.shift();
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new UsageError(`Invalid --timeout-ms value: ${raw}`);
      }
      options.timeoutMs = parsed;
    } else if (arg === '--bridge-url') {
      options.bridgeUrl = args.shift();
    } else if (arg === '--token') {
      options.token = args.shift();
    } else if (arg === '--attach-file') {
      options.attachFile = args.shift();
    } else if (arg === '--port') {
      const raw = args.shift();
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        throw new UsageError(`Invalid --port value: ${raw}`);
      }
      options.port = parsed;
    } else if (arg === '--output') {
      options.output = args.shift();
    } else if (arg === '--file') {
      options.file = args.shift();
    } else if (arg === '--lecture-id') {
      options.lectureId = args.shift();
    } else if (arg === '--course-id') {
      options.courseId = args.shift();
    } else if (arg === '--note-id') {
      options.noteId = args.shift();
    } else if (arg === '--pdf-path') {
      options.pdfPath = args.shift();
    } else if (arg === '--transcript-text') {
      options.transcriptText = args.shift();
    } else if (arg === '--content') {
      options.content = args.shift();
    } else if (arg === '--language') {
      options.language = args.shift();
    } else if (arg === '--force-refresh') {
      options.forceRefresh = true;
    } else if (arg === '--write-note') {
      options.writeNote = true;
    } else if (arg === '--no-write-note') {
      options.writeNote = false;
    } else if (arg === '--max-events') {
      const raw = args.shift();
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new UsageError(`Invalid --max-events value: ${raw}`);
      }
      options.maxEvents = parsed;
    } else if (arg === '--target') {
      options.target = args.shift();
    } else if (arg === '--selector') {
      options.selector = args.shift();
    } else if (arg === '--text') {
      options.text = args.shift();
    } else if (arg === '--path') {
      options.path = args.shift();
    } else if (arg === '--key') {
      options.key = args.shift();
    } else if (arg === '--clear') {
      options.clear = true;
    } else if (arg === '--follow') {
      options.follow = true;
    } else if (arg === '--launch-app') {
      options.launchApp = true;
    } else if (arg === '--keep-app') {
      options.keepApp = true;
    } else if (arg === '--detach') {
      options.detach = true;
    } else if (arg === '--dev') {
      options.dev = true;
    } else if (arg === '--help' || arg === '-h') {
      options.command = 'help';
    } else {
      options.positional.push(arg);
    }
  }

  return options;
}

class UsageError extends Error {}

function handshakePayload() {
  return {
    schemaVersion: 1,
    cli: {
      name: 'cnai-agent',
      version: CLI_VERSION,
    },
    app: {
      packageName: PACKAGE_JSON.name,
      version: PACKAGE_JSON.version,
    },
    capabilities: [
      {
        id: 'agent.handshake',
        stability: 'stable',
        description: 'Return the local CLI capability contract.',
      },
      {
        id: 'agent.smoke',
        stability: 'experimental',
        description: 'Run local smoke profiles with machine-readable results.',
      },
      {
        id: 'app.handshake',
        stability: 'experimental',
        description: 'Negotiate with a running app bridge.',
      },
      {
        id: 'app.status',
        stability: 'experimental',
        description: 'Inspect a running app bridge state.',
      },
      {
        id: 'app.ai-status',
        stability: 'experimental',
        description: 'Inspect AI provider readiness reported by the app bridge.',
      },
      {
        id: 'app.launch',
        stability: 'experimental',
        description: 'Launch the desktop app with the agent bridge enabled.',
      },
      {
        id: 'app.attach',
        stability: 'experimental',
        description: 'Read the local app bridge attach file.',
      },
      {
        id: 'events.watch',
        stability: 'experimental',
        description: 'Stream structured app events from the bridge.',
      },
      {
        id: 'tasks.list',
        stability: 'experimental',
        description: 'List bridge task lifecycle records.',
      },
      {
        id: 'logs.tail',
        stability: 'experimental',
        description: 'Tail app logs through the bridge.',
      },
      {
        id: 'diag.bundle',
        stability: 'experimental',
        description: 'Create a local diagnostic bundle for CLI/app bridge debugging.',
      },
      {
        id: 'workflow.list',
        stability: 'experimental',
        description: 'List workflow command contracts exposed by this CLI.',
      },
      {
        id: 'workflow.import-media',
        stability: 'experimental',
        description: 'Import audio/video media through the app bridge.',
      },
      {
        id: 'workflow.ocr-index',
        stability: 'experimental',
        description: 'Build a lecture OCR/RAG index through the app bridge.',
      },
      {
        id: 'workflow.summarize',
        stability: 'experimental',
        description: 'Generate a lecture summary through the app bridge.',
      },
      {
        id: 'call.raw',
        stability: 'planned',
        description: 'Invoke a raw app command through the bridge.',
      },
      {
        id: 'ui.snapshot',
        stability: 'experimental',
        description: 'Capture visual state through the bridge.',
      },
      {
        id: 'ui.tree',
        stability: 'experimental',
        description: 'Read semantic UI state through the bridge.',
      },
      {
        id: 'ui.action',
        stability: 'experimental',
        description: 'Drive renderer UI actions through the bridge.',
      },
    ],
    bridge: {
      transport: 'http',
      env: 'CNAI_AGENT_BRIDGE_URL',
      defaultUrl: DEFAULT_BRIDGE_URL || null,
      attachFile: DEFAULT_ATTACH_FILE,
      status: DEFAULT_BRIDGE_URL ? 'configured' : 'not_configured',
    },
    smokeProfiles: Object.fromEntries(
      [
        ...Object.entries(PROFILES).map(([name, steps]) => [
          name,
          steps.map((step) => step.id),
        ]),
        ['app-bridge', appBridgeSmokeStepIds()],
      ],
    ),
    outputFormats: ['human', 'json', 'ndjson'],
    exitCodes: {
      0: 'success',
      1: 'command_failed',
      2: 'usage_or_internal_error',
      3: 'bridge_unavailable',
    },
  };
}

function printPayload(payload, format) {
  if (format === 'json' || format === 'ndjson') {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function errorPayload(type, status, message, extra = {}) {
  return {
    schemaVersion: 1,
    type,
    status,
    message,
    ...extra,
  };
}

function bridgeUnavailablePayload(command, bridgeUrl, message) {
  return errorPayload('bridge_unavailable', 'unavailable', message, {
    command,
    bridge: {
      configured: Boolean(bridgeUrl),
      url: bridgeUrl || null,
      transport: 'http',
    },
    nextStep:
      'Start ClassNoteAI with the agent bridge enabled, then pass --bridge-url or set CNAI_AGENT_BRIDGE_URL.',
  });
}

function readAttachFile(attachFile = DEFAULT_ATTACH_FILE) {
  if (!attachFile || !existsSync(attachFile)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(attachFile, 'utf8'));
  } catch {
    return null;
  }
}

function resolveBridge(options) {
  const attach = readAttachFile(options.attachFile);
  const url = options.bridgeUrl || attach?.url || '';
  const token = options.token || attach?.token || '';
  return {
    url,
    token,
    attach,
  };
}

function bridgeEndpoint(bridgeUrl, path) {
  if (!bridgeUrl) {
    return null;
  }
  return `${bridgeUrl.replace(/\/+$/u, '')}${path}`;
}

async function requestBridgeJson(command, options, path, init = {}) {
  const bridge = resolveBridge(options);
  const endpoint = bridgeEndpoint(bridge.url, path);
  if (!endpoint) {
    return {
      code: 3,
      payload: bridgeUnavailablePayload(
        command,
        bridge.url,
        'No app bridge URL is configured.',
      ),
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: init.method ?? 'GET',
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      headers: {
        accept: 'application/json',
        ...(bridge.token ? { authorization: `Bearer ${bridge.token}` } : {}),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    return {
      code: response.ok ? 0 : 1,
      payload: {
        schemaVersion: 1,
        type: command,
        status: response.ok ? 'ok' : 'failed',
        bridge: {
          url: bridge.url,
          httpStatus: response.status,
          attachFile: options.attachFile,
        },
        body,
      },
    };
  } catch (error) {
    return {
      code: 3,
      payload: bridgeUnavailablePayload(
        command,
        bridge.url,
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

async function readBridgeJson(command, bridgeUrl, path) {
  return requestBridgeJson(command, { bridgeUrl, token: DEFAULT_BRIDGE_TOKEN, attachFile: DEFAULT_ATTACH_FILE }, path);
}

function emitEvent(event, options) {
  const payload = {
    schemaVersion: 1,
    timestamp: nowIso(),
    ...event,
  };

  if (options.format === 'ndjson') {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else if (options.format === 'human') {
    const label = event.stepId ? `${event.type}:${event.stepId}` : event.type;
    process.stderr.write(`[${label}] ${event.message ?? ''}\n`);
  }

  return payload;
}

function trimLog(value, maxLength = 12_000) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`;
}

function shellQuote(value) {
  if (!/[\s"]/u.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '\\"')}"`;
}

function spawnSpec(step) {
  if (process.platform !== 'win32') {
    return {
      command: step.command,
      args: step.args,
    };
  }

  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', [step.command, ...step.args].map(shellQuote).join(' ')],
  };
}

async function runStep(step, options) {
  const timeoutMs = options.timeoutMs ?? step.timeoutMs;
  const startedAt = nowIso();
  emitEvent(
    {
      type: 'step_started',
      stepId: step.id,
      command: [step.command, ...step.args],
      timeoutMs,
      message: `running ${step.id}`,
    },
    options,
  );

  if (options.dryRun) {
    const result = {
      id: step.id,
      status: 'skipped',
      startedAt,
      finishedAt: nowIso(),
      durationMs: 0,
      exitCode: 0,
      command: [step.command, ...step.args],
      stdout: '',
      stderr: '',
    };
    emitEvent(
      {
        type: 'step_finished',
        stepId: step.id,
        status: result.status,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        message: `${step.id} ${result.status}`,
      },
      options,
    );
    return result;
  }

  const result = await new Promise((resolveStep) => {
    const spec = spawnSpec(step);
    const child = spawn(spec.command, spec.args, {
      cwd: PROJECT_ROOT,
      env: process.env,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const startMs = Date.now();
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (options.format === 'human') {
        process.stderr.write(text);
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options.format === 'human') {
        process.stderr.write(text);
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      resolveStep({
        id: step.id,
        status: 'failed',
        startedAt,
        finishedAt: nowIso(),
        durationMs: Date.now() - startMs,
        exitCode: 1,
        command: [step.command, ...step.args],
        stdout: trimLog(stdout),
        stderr: trimLog(`${stderr}\n${error.message}`.trim()),
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const status = timedOut ? 'timed_out' : code === 0 ? 'passed' : 'failed';
      resolveStep({
        id: step.id,
        status,
        startedAt,
        finishedAt: nowIso(),
        durationMs: Date.now() - startMs,
        exitCode: timedOut ? 124 : code ?? 1,
        signal,
        command: [step.command, ...step.args],
        stdout: trimLog(stdout),
        stderr: trimLog(stderr),
      });
    });
  });

  emitEvent(
    {
      type: 'step_finished',
      stepId: step.id,
      status: result.status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      message: `${step.id} ${result.status}`,
    },
    options,
  );

  return result;
}

async function runSmoke(options) {
  if (options.profile === 'app-bridge') {
    return runAppBridgeSmoke(options);
  }

  const steps = PROFILES[options.profile];
  if (!steps) {
    throw new UsageError(
      `Unknown profile: ${options.profile}. Expected one of: ${Object.keys(PROFILES).join(', ')}`,
    );
  }

  const startedAt = nowIso();
  emitEvent(
    {
      type: 'run_started',
      profile: options.profile,
      dryRun: options.dryRun,
      message: `starting ${options.profile} smoke profile`,
    },
    options,
  );

  const results = [];
  for (const step of steps) {
    const result = await runStep(step, options);
    results.push(result);
    if (result.status !== 'passed' && result.status !== 'skipped') {
      break;
    }
  }

  const failed = results.find(
    (result) => result.status !== 'passed' && result.status !== 'skipped',
  );
  const payload = {
    schemaVersion: 1,
    type: 'smoke_result',
    profile: options.profile,
    status: failed ? 'failed' : 'passed',
    dryRun: options.dryRun,
    startedAt,
    finishedAt: nowIso(),
    steps: results,
  };

  emitEvent(
    {
      type: 'run_finished',
      profile: options.profile,
      status: payload.status,
      message: `${options.profile} smoke ${payload.status}`,
    },
    options,
  );

  if (options.format === 'json') {
    printPayload(payload, 'json');
  } else if (options.format === 'human') {
    printPayload(payload, 'human');
  }

  return payload.status === 'passed' ? 0 : 1;
}

function appBridgeSmokeStepIds() {
  return [
    'launch',
    'attach',
    'handshake',
    'status',
    'logs',
    'events',
    'raw-command',
    'ui-tree',
    'ui-ready',
    'ai-config',
    'ui-snapshot',
    'workflow-import-media',
    'tasks',
  ];
}

async function runAppBridgeSmoke(options) {
  const startedAt = nowIso();
  const results = [];
  let launchedProcess = null;
  let cleanupProcess = null;
  const smokeOptions = {
    ...options,
    attachFile: options.attachFile || resolve(tmpdir(), `cnai-agent-bridge-${Date.now()}.json`),
  };

  emitEvent(
    {
      type: 'run_started',
      profile: options.profile,
      dryRun: options.dryRun,
      message: 'starting app bridge smoke profile',
    },
    options,
  );

  try {
    if (options.launchApp) {
      const launchResult = await runAppBridgeSmokeStep('launch', options, async () => {
        if (options.dryRun) {
          return {
            status: 'skipped',
            message: 'launch skipped for dry-run',
            data: {
              attachFile: smokeOptions.attachFile,
            },
          };
        }
        const launch = launchAppForSmoke(smokeOptions);
        launchedProcess = launch.child;
        cleanupProcess = launch.cleanup;
        await waitForAttach(smokeOptions.attachFile, options.timeoutMs ?? 120_000);
        return {
          status: 'passed',
          message: 'app bridge attach file created',
          data: {
            pid: launchedProcess.pid,
            attachFile: smokeOptions.attachFile,
          },
        };
      });
      results.push(launchResult);
      if (launchResult.status === 'failed') return finishAppBridgeSmoke(options, startedAt, results);
    } else {
      results.push({
        id: 'launch',
        status: 'skipped',
        startedAt,
        finishedAt: nowIso(),
        durationMs: 0,
        message: 'use --launch-app to start the desktop app for this smoke profile',
      });
    }

    for (const stepId of appBridgeSmokeStepIds().filter((id) => id !== 'launch')) {
      const result = await runAppBridgeSmokeStep(stepId, smokeOptions, () => runAppBridgeCheck(stepId, smokeOptions));
      results.push(result);
      if (result.status === 'failed') break;
    }

    return finishAppBridgeSmoke(options, startedAt, results);
  } finally {
    if (cleanupProcess && !options.keepApp) {
      cleanupProcess();
    }
  }
}

async function runAppBridgeSmokeStep(id, options, fn) {
  const startedAt = nowIso();
  const startedMs = Date.now();
  emitEvent(
    {
      type: 'step_started',
      stepId: id,
      timeoutMs: options.timeoutMs,
      message: `running ${id}`,
    },
    options,
  );

  let result;
  if (options.dryRun && id !== 'launch') {
    result = {
      id,
      status: 'skipped',
      startedAt,
      finishedAt: nowIso(),
      durationMs: 0,
      message: `${id} skipped for dry-run`,
    };
  } else {
    try {
      const outcome = await fn();
      result = {
        id,
        status: outcome.status,
        startedAt,
        finishedAt: nowIso(),
        durationMs: Date.now() - startedMs,
        message: outcome.message,
        data: outcome.data,
      };
    } catch (error) {
      result = {
        id,
        status: 'failed',
        startedAt,
        finishedAt: nowIso(),
        durationMs: Date.now() - startedMs,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  emitEvent(
    {
      type: 'step_finished',
      stepId: id,
      status: result.status,
      durationMs: result.durationMs,
      message: `${id} ${result.status}`,
    },
    options,
  );
  return result;
}

async function runAppBridgeCheck(stepId, options) {
  if (stepId === 'attach') {
    const attach = readAttachFile(options.attachFile);
    if (!attach) {
      throw new Error(`No attach file found at ${options.attachFile}. Use --launch-app or pass --attach-file.`);
    }
    return {
      status: 'passed',
      message: 'attach file readable',
      data: {
        url: attach.url,
        pid: attach.pid,
        apiVersion: attach.apiVersion,
      },
    };
  }

  const checks = {
    handshake: ['app_handshake', '/v1/handshake', {}],
    status: ['app_status', '/v1/status', {}],
    logs: ['logs_tail', '/v1/logs', {}],
    events: ['events_watch', '/v1/events', {}],
    'raw-command': ['call_raw', '/v1/call/raw', {
      method: 'POST',
      body: { command: 'get_build_features', args: [] },
    }],
    'ui-tree': ['ui_tree', '/v1/ui/tree', {}],
    'ui-snapshot': ['ui_snapshot', '/v1/ui/snapshot', {}],
    'workflow-import-media': ['workflow_import-media', '/v1/workflow/import-media', {
      method: 'POST',
      body: {
        dryRun: true,
        lectureId: 'agent-smoke-lecture',
        file: 'agent-smoke-media.mp4',
        language: 'auto',
      },
    }],
    tasks: ['tasks_list', '/v1/tasks', {}],
  };
  if (stepId === 'ui-ready') {
    return waitForRendererUi(options);
  }
  if (stepId === 'ai-config') {
    return waitForAiConfig(options);
  }

  const check = checks[stepId];
  if (!check) {
    throw new Error(`Unknown app bridge smoke step: ${stepId}`);
  }

  const [command, path, init] = check;
  const { code, payload } = await requestBridgeJson(command, options, path, init);
  if (code !== 0) {
    throw new Error(payload.message || payload.body?.message || `${stepId} failed`);
  }
  return {
    status: 'passed',
    message: `${stepId} passed`,
    data: summarizeSmokePayload(payload),
  };
}

async function waitForAiConfig(options) {
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  let lastStatus = null;
  while (Date.now() <= deadline) {
    const { code, payload } = await requestBridgeJson('app_ai_status', {
      ...options,
      timeoutMs: Math.min(options.timeoutMs ?? 5000, 5000),
    }, '/v1/config/ai');
    lastStatus = payload.body?.status ?? null;
    if (code === 0 && lastStatus === 'ok') {
      return {
        status: 'passed',
        message: 'AI provider state registered',
        data: summarizeSmokePayload(payload),
      };
    }
    await sleep(250);
  }
  throw new Error(`AI provider state did not register before timeout; last status: ${lastStatus ?? 'unknown'}`);
}

async function waitForRendererUi(options) {
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  let lastSource = null;
  while (Date.now() <= deadline) {
    const { code, payload } = await requestBridgeJson('ui_tree', {
      ...options,
      timeoutMs: Math.min(options.timeoutMs ?? 5000, 5000),
    }, '/v1/ui/tree');
    lastSource = payload.body?.source ?? null;
    if (code === 0 && lastSource === 'renderer-dom') {
      return {
        status: 'passed',
        message: 'renderer UI state registered',
        data: summarizeSmokePayload(payload),
      };
    }
    await sleep(250);
  }
  throw new Error(`Renderer UI state did not register before timeout; last source: ${lastSource ?? 'unknown'}`);
}

function summarizeSmokePayload(payload) {
  return {
    type: payload.type,
    httpStatus: payload.bridge?.httpStatus,
    status: payload.body?.status ?? payload.status,
    taskId: payload.body?.taskId ?? null,
    workflowId: payload.body?.workflowId ?? null,
    eventCount: Array.isArray(payload.body?.events) ? payload.body.events.length : undefined,
    taskCount: Array.isArray(payload.body?.tasks) ? payload.body.tasks.length : undefined,
  };
}

function finishAppBridgeSmoke(options, startedAt, results) {
  const failed = results.find((result) => result.status === 'failed');
  const payload = {
    schemaVersion: 1,
    type: 'smoke_result',
    profile: 'app-bridge',
    status: failed ? 'failed' : 'passed',
    dryRun: options.dryRun,
    launchedApp: options.launchApp,
    startedAt,
    finishedAt: nowIso(),
    steps: results,
  };

  emitEvent(
    {
      type: 'run_finished',
      profile: 'app-bridge',
      status: payload.status,
      message: `app-bridge smoke ${payload.status}`,
    },
    options,
  );

  if (options.format === 'json') {
    printPayload(payload, 'json');
  } else if (options.format === 'human') {
    printPayload(payload, 'human');
  }

  return payload.status === 'passed' ? 0 : 1;
}

function launchAppForSmoke(options) {
  const command = npmExec();
  const args = ['run', 'tauri', '--', 'dev'];
  const env = {
    ...process.env,
    CNAI_AGENT_BRIDGE: '1',
    CNAI_AGENT_ATTACH_FILE: options.attachFile,
  };
  if (options.port !== undefined) {
    env.CNAI_AGENT_BRIDGE_PORT = String(options.port);
  } else {
    env.CNAI_AGENT_BRIDGE_PORT = '0';
  }

  const spec = spawnSpec({ command, args });
  const child = spawn(spec.command, spec.args, {
    cwd: PROJECT_ROOT,
    env,
    stdio: 'ignore',
    windowsHide: true,
  });

  return {
    child,
    cleanup: () => stopSpawnedProcess(child),
  };
}

function stopSpawnedProcess(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  child.kill('SIGTERM');
}

async function waitForAttach(attachFile, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (readAttachFile(attachFile)) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for bridge attach file: ${attachFile}`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function launchApp(options) {
  const command = npmExec();
  const args = ['run', 'tauri', '--', 'dev'];
  const env = {
    ...process.env,
    CNAI_AGENT_BRIDGE: '1',
    CNAI_AGENT_ATTACH_FILE: options.attachFile,
  };
  if (options.port !== undefined) {
    env.CNAI_AGENT_BRIDGE_PORT = String(options.port);
  }

  if (options.dryRun) {
    const payload = {
      schemaVersion: 1,
      type: 'app_launch',
      status: 'skipped',
      dryRun: true,
      command: [command, ...args],
      env: {
        CNAI_AGENT_BRIDGE: env.CNAI_AGENT_BRIDGE,
        CNAI_AGENT_BRIDGE_PORT: env.CNAI_AGENT_BRIDGE_PORT ?? null,
        CNAI_AGENT_ATTACH_FILE: env.CNAI_AGENT_ATTACH_FILE,
      },
    };
    printPayload(payload, options.format);
    return 0;
  }

  const spec = spawnSpec({ command, args });
  const child = spawn(spec.command, spec.args, {
    cwd: PROJECT_ROOT,
    env,
    detached: options.detach,
    stdio: options.detach ? 'ignore' : 'inherit',
    windowsHide: false,
  });
  if (options.detach) {
    child.unref();
  }

  const payload = {
    schemaVersion: 1,
    type: 'app_launch',
    status: 'started',
    pid: child.pid,
    detached: options.detach,
    attachFile: options.attachFile,
    command: [command, ...args],
  };
  printPayload(payload, options.format);
  return 0;
}

function workflowContracts() {
  return {
    schemaVersion: 1,
    type: 'workflow_contracts',
    status: 'ok',
    workflows: [
      {
        id: 'smoke.quick',
        stability: 'experimental',
        command: ['smoke', '--profile', 'quick'],
        description: 'Run the fastest local sub-agent sanity check.',
      },
      {
        id: 'smoke.frontend',
        stability: 'experimental',
        command: ['smoke', '--profile', 'frontend'],
        description: 'Run typecheck and Vitest through the agent CLI.',
      },
      {
        id: 'smoke.release',
        stability: 'experimental',
        command: ['smoke', '--profile', 'release'],
        description: 'Run the frontend release gate through the agent CLI.',
      },
      {
        id: 'diagnostics',
        stability: 'experimental',
        command: ['workflow', 'diagnostics'],
        requiresBridge: true,
        description: 'Create an app-backed diagnostic bundle through the bridge.',
      },
      {
        id: 'import-media',
        stability: 'experimental',
        command: ['workflow', 'import-media', '--lecture-id', '<id>', '--file', '<path>'],
        requiresBridge: true,
        description: 'Import an audio/video file into a lecture through the app bridge.',
      },
      {
        id: 'ocr-index',
        stability: 'experimental',
        command: ['workflow', 'ocr-index', '--lecture-id', '<id>', '--pdf-path', '<path>'],
        requiresBridge: true,
        description: 'Index course material through the app bridge.',
      },
      {
        id: 'summarize',
        stability: 'experimental',
        command: ['workflow', 'summarize', '--lecture-id', '<id>'],
        requiresBridge: true,
        description: 'Generate a lecture summary through the app bridge.',
      },
      {
        id: 'chat',
        stability: 'planned',
        command: ['workflow', 'chat', '--course-id', '<id>', '--message', '<text>'],
        requiresBridge: true,
        description: 'Ask the AI tutor through the app bridge.',
      },
    ],
  };
}

async function handleAppCommand(options) {
  const subcommand = options.commandParts[1];
  if (subcommand === 'launch') {
    return launchApp(options);
  }

  if (subcommand === 'attach') {
    const attach = readAttachFile(options.attachFile);
    if (!attach) {
      printPayload(
        bridgeUnavailablePayload(
          'app_attach',
          options.bridgeUrl,
          `No attach file found at ${options.attachFile}.`,
        ),
        options.format,
      );
      return 3;
    }
    printPayload(
      {
        schemaVersion: 1,
        type: 'app_attach',
        status: 'ok',
        attachFile: options.attachFile,
        bridge: {
          url: attach.url,
          pid: attach.pid,
          apiVersion: attach.apiVersion,
          createdAt: attach.createdAt,
        },
      },
      options.format,
    );
    return 0;
  }

  if (subcommand === 'handshake') {
    const { code, payload } = await requestBridgeJson(
      'app_handshake',
      options,
      '/v1/handshake',
    );
    printPayload(payload, options.format);
    return code;
  }

  if (subcommand === 'status') {
    const { code, payload } = await requestBridgeJson(
      'app_status',
      options,
      '/v1/status',
    );
    printPayload(payload, options.format);
    return code;
  }

  if (subcommand === 'ai-status') {
    const { code, payload } = await requestBridgeJson(
      'app_ai_status',
      options,
      '/v1/config/ai',
    );
    printPayload(payload, options.format);
    return code;
  }

  throw new UsageError(`Unknown app command: ${subcommand ?? ''}`);
}

async function handleEventsCommand(options) {
  const subcommand = options.commandParts[1];
  if (subcommand !== 'watch') {
    throw new UsageError(`Unknown events command: ${subcommand ?? ''}`);
  }

  const bridge = resolveBridge(options);
  if (!bridge.url) {
    printPayload(
      bridgeUnavailablePayload('events_watch', bridge.url, 'No app bridge URL is configured.'),
      options.format,
    );
    return 3;
  }

  const endpoint = bridgeEndpoint(bridge.url, options.follow ? '/v1/events?follow=1' : '/v1/events');
  try {
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      headers: {
        accept: 'text/event-stream',
        ...(bridge.token ? { authorization: `Bearer ${bridge.token}` } : {}),
      },
    });
    if (options.follow) {
      const streamed = await streamSseEvents(response, options, bridge.url);
      return streamed ? 0 : 1;
    }
    const text = await response.text();
    const events = parseSse(text);
    if (options.format === 'ndjson') {
      for (const event of events) {
        process.stdout.write(`${JSON.stringify(event)}\n`);
      }
    } else {
      printPayload(
        {
          schemaVersion: 1,
          type: 'events_watch',
          status: response.ok ? 'ok' : 'failed',
          bridge: { url: bridge.url, httpStatus: response.status },
          events,
        },
        options.format,
      );
    }
    return response.ok ? 0 : 1;
  } catch (error) {
    printPayload(
      bridgeUnavailablePayload(
        'events_watch',
        bridge.url,
        error instanceof Error ? error.message : String(error),
      ),
      options.format,
    );
    return 3;
  }
}

async function handleTasksCommand(options) {
  const subcommand = options.commandParts[1];
  if (subcommand !== 'list') {
    throw new UsageError(`Unknown tasks command: ${subcommand ?? ''}`);
  }
  const { code, payload } = await requestBridgeJson('tasks_list', options, '/v1/tasks');
  printPayload(payload, options.format);
  return code;
}

async function streamSseEvents(response, options, bridgeUrl) {
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    printPayload(
      {
        schemaVersion: 1,
        type: 'events_watch',
        status: 'failed',
        bridge: { url: bridgeUrl, httpStatus: response.status },
        body: text,
      },
      options.format,
    );
    return false;
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let count = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/u);
    buffer = parts.pop() ?? '';
    for (const block of parts) {
      const events = parseSse(block);
      for (const event of events) {
        count += 1;
        if (options.format === 'ndjson') {
          process.stdout.write(`${JSON.stringify(event)}\n`);
        } else {
          printPayload(event, options.format);
        }
        if (options.maxEvents && count >= options.maxEvents) {
          await reader.cancel();
          return true;
        }
      }
    }
  }
  return true;
}

async function handleLogsCommand(options) {
  const subcommand = options.commandParts[1];
  if (subcommand !== 'tail') {
    throw new UsageError(`Unknown logs command: ${subcommand ?? ''}`);
  }

  const bridge = resolveBridge(options);
  if (!bridge.url) {
    printPayload(
      bridgeUnavailablePayload('logs_tail', bridge.url, 'No app bridge URL is configured.'),
      options.format,
    );
    return 3;
  }

  const path = options.follow ? '/v1/logs?follow=1' : '/v1/logs';
  const { code, payload } = await requestBridgeJson('logs_tail', options, path);
  printPayload(payload, options.format);
  return code;
}

function writeDiagBundle(options) {
  const createdAt = nowIso();
  const defaultDir = resolve(tmpdir(), 'classnoteai-agent');
  mkdirSync(defaultDir, { recursive: true });
  const outputPath =
    options.output ?? resolve(defaultDir, `diag-${createdAt.replace(/[:.]/gu, '-')}.json`);
  const payload = {
    schemaVersion: 1,
    type: 'diag_bundle',
    status: 'ok',
    createdAt,
    cli: handshakePayload().cli,
    app: handshakePayload().app,
    bridge: handshakePayload().bridge,
    platform: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
    },
    outputPath,
  };
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  printPayload(payload, options.format);
  return 0;
}

async function handleDiagCommand(options) {
  const subcommand = options.commandParts[1];
  if (subcommand !== 'bundle') {
    throw new UsageError(`Unknown diag command: ${subcommand ?? ''}`);
  }
  const bridge = resolveBridge(options);
  if (bridge.url && !options.output) {
    const { code, payload } = await requestBridgeJson('diag_bundle', options, '/v1/diag/bundle', {
      method: 'POST',
      body: {},
    });
    printPayload(payload, options.format);
    return code;
  }
  return writeDiagBundle(options);
}

async function handleWorkflowCommand(options) {
  const subcommand = options.commandParts[1];
  if (subcommand === 'list') {
    const bridge = resolveBridge(options);
    if (bridge.url) {
      const { code, payload } = await requestBridgeJson('workflow_list', options, '/v1/workflows');
      printPayload(payload, options.format);
      return code;
    }
    printPayload(workflowContracts(), options.format);
    return 0;
  }

  const contracts = workflowContracts().workflows;
  const contract = contracts.find((item) => item.id === subcommand);
  if (contract?.requiresBridge) {
    const { code, payload } = await requestBridgeJson(
      `workflow_${subcommand}`,
      options,
      `/v1/workflow/${subcommand}`,
      {
        method: 'POST',
        body: {
          file: options.file ?? null,
          lectureId: options.lectureId ?? null,
          courseId: options.courseId ?? null,
          noteId: options.noteId ?? null,
          pdfPath: options.pdfPath ?? null,
          transcriptText: options.transcriptText ?? null,
          content: options.content ?? null,
          language: options.language ?? null,
          forceRefresh: options.forceRefresh,
          writeNote: options.writeNote ?? null,
          dryRun: options.dryRun,
        },
      },
    );
    printPayload(payload, options.format);
    return code;
  }

  throw new UsageError(`Unknown workflow command: ${subcommand ?? ''}`);
}

function parseSse(text) {
  return text
    .split(/\r?\n\r?\n/u)
    .filter((block) => block.trim().length > 0)
    .flatMap((block) => {
      const event = { schemaVersion: 1, type: 'sse_event', event: 'message', data: null };
      const dataLines = [];
      for (const line of block.split(/\r?\n/u)) {
        if (line.startsWith(':')) {
          continue;
        }
        if (line.startsWith('event:')) {
          event.event = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trim());
        }
      }
      if (dataLines.length === 0) {
        return [];
      }
      const dataText = dataLines.join('\n');
      try {
        event.data = dataText ? JSON.parse(dataText) : null;
      } catch {
        event.data = dataText;
      }
      return [event];
    });
}

async function handleUiCommand(options) {
  const subcommand = options.commandParts[1];
  if (['snapshot', 'tree'].includes(subcommand)) {
    const { code, payload } = await requestBridgeJson(`ui_${subcommand}`, options, `/v1/ui/${subcommand}`);
    printPayload(payload, options.format);
    return code;
  }

  if (!['click', 'type', 'key', 'navigate', 'wait-for'].includes(subcommand)) {
    throw new UsageError(`Unknown ui command: ${subcommand ?? ''}`);
  }

  const body = uiActionBody(subcommand, options);
  const requestOptions = subcommand === 'wait-for'
    ? {
        ...options,
        timeoutMs: Math.max(options.timeoutMs ?? 5000, (body.timeoutMs ?? 5000) + 5000),
      }
    : options;
  const { code, payload } = await requestBridgeJson(`ui_${subcommand.replace('-', '_')}`, requestOptions, `/v1/ui/${subcommand}`, {
    method: 'POST',
    body,
  });
  printPayload(payload, options.format);
  return code;
}

function uiActionBody(subcommand, options) {
  if (subcommand === 'click') {
    if (!options.target && !options.selector) {
      throw new UsageError('ui click requires --target or --selector');
    }
    return { target: options.target ?? null, selector: options.selector ?? null };
  }

  if (subcommand === 'type') {
    if (!options.target && !options.selector) {
      throw new UsageError('ui type requires --target or --selector');
    }
    if (options.text == null) {
      throw new UsageError('ui type requires --text');
    }
    return {
      target: options.target ?? null,
      selector: options.selector ?? null,
      text: options.text,
      clear: options.clear,
    };
  }

  if (subcommand === 'key') {
    if (!options.key && !options.text) {
      throw new UsageError('ui key requires --key');
    }
    return { key: options.key ?? options.text };
  }

  if (subcommand === 'navigate') {
    if (!options.path) {
      throw new UsageError('ui navigate requires --path');
    }
    return { path: options.path };
  }

  if (!options.target && !options.selector && options.text == null) {
    throw new UsageError('ui wait-for requires --target, --selector, or --text');
  }
  return {
    target: options.target ?? null,
    selector: options.selector ?? null,
    text: options.text ?? null,
    timeoutMs: options.timeoutMs ?? 5000,
  };
}

async function handleCallCommand(options) {
  const subcommand = options.commandParts[1];
  if (subcommand !== 'raw') {
    throw new UsageError(`Unknown call command: ${subcommand ?? ''}`);
  }
  const command = options.positional[0];
  if (!command) {
    throw new UsageError('call raw requires a command name');
  }
  const { code, payload } = await requestBridgeJson('call_raw', options, '/v1/call/raw', {
    method: 'POST',
    body: {
      command,
      args: options.positional.slice(1),
    },
  });
  printPayload(payload, options.format);
  return code;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${usage()}`);
      return 2;
    }
    throw error;
  }

  if (!options.command || options.command === 'help') {
    process.stdout.write(usage());
    return 0;
  }

  options.commandParts = options.command.split(':');

  try {
    if (options.command === 'handshake') {
      printPayload(handshakePayload(), options.format);
      return 0;
    }
    if (options.commandParts[0] === 'app') {
      return await handleAppCommand(options);
    }
    if (options.commandParts[0] === 'events') {
      return await handleEventsCommand(options);
    }
    if (options.commandParts[0] === 'tasks') {
      return await handleTasksCommand(options);
    }
    if (options.commandParts[0] === 'logs') {
      return await handleLogsCommand(options);
    }
    if (options.commandParts[0] === 'diag') {
      return await handleDiagCommand(options);
    }
    if (options.commandParts[0] === 'workflow') {
      return await handleWorkflowCommand(options);
    }
    if (options.commandParts[0] === 'ui') {
      return await handleUiCommand(options);
    }
    if (options.commandParts[0] === 'call') {
      return await handleCallCommand(options);
    }
    if (options.command === 'smoke') {
      return await runSmoke(options);
    }
    throw new UsageError(`Unknown command: ${options.command}`);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${usage()}`);
      return 2;
    }

    const payload = {
      schemaVersion: 1,
      type: 'internal_error',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
    if (options?.format === 'json' || options?.format === 'ndjson') {
      printPayload(payload, options.format);
    } else {
      process.stderr.write(`${payload.message}\n`);
    }
    return 2;
  }
}

process.exitCode = await main();
