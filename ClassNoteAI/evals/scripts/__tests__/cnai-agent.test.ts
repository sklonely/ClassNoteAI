import { execFileSync, spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDir, '../../..');
const cliPath = resolve(projectRoot, 'scripts/cnai-agent.mjs');

function runCli(args: string[]) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CNAI_AGENT_ATTACH_FILE: resolve(tmpdir(), 'cnai-agent-test-noattach.json'),
      CNAI_AGENT_BRIDGE_URL: '',
    },
  });
}

function runCliJson(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  });
}

function runCliAsync(args: string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolveRun) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (status) => {
      resolveRun({ status, stdout, stderr });
    });
  });
}

describe('cnai-agent CLI', () => {
  it('prints a versioned handshake contract', () => {
    const payload = JSON.parse(runCli(['handshake', '--json']));

    expect(payload.schemaVersion).toBe(1);
    expect(payload.cli.name).toBe('cnai-agent');
    expect(payload.app.packageName).toBe('classnoteai');
    expect(payload.capabilities.map((cap: { id: string }) => cap.id)).toEqual(
      expect.arrayContaining(['agent.handshake', 'agent.smoke']),
    );
    expect(payload.smokeProfiles.quick).toEqual(['typecheck']);
    expect(payload.smokeProfiles['app-bridge']).toEqual(
      expect.arrayContaining(['attach', 'handshake', 'workflow-import-media']),
    );
    expect(payload.capabilities.map((cap: { id: string }) => cap.id)).toEqual(
      expect.arrayContaining([
        'app.launch',
        'app.attach',
        'app.status',
        'app.ai-status',
        'events.watch',
        'logs.tail',
        'diag.bundle',
        'ui.snapshot',
        'call.raw',
      ]),
    );
  });

  it('supports dry-run smoke output without executing tools', () => {
    const payload = JSON.parse(
      runCli(['smoke', '--profile', 'frontend', '--dry-run', '--json']),
    );

    expect(payload.schemaVersion).toBe(1);
    expect(payload.type).toBe('smoke_result');
    expect(payload.profile).toBe('frontend');
    expect(payload.status).toBe('passed');
    expect(payload.steps).toHaveLength(2);
    expect(payload.steps.map((step: { status: string }) => step.status)).toEqual([
      'skipped',
      'skipped',
    ]);
  });

  it('supports app bridge smoke dry-runs without launching the app', () => {
    const payload = JSON.parse(
      runCli(['smoke', '--profile', 'app-bridge', '--dry-run', '--json']),
    );

    expect(payload.schemaVersion).toBe(1);
    expect(payload.type).toBe('smoke_result');
    expect(payload.profile).toBe('app-bridge');
    expect(payload.status).toBe('passed');
    expect(payload.launchedApp).toBe(false);
    expect(payload.steps.map((step: { id: string }) => step.id)).toEqual(
      expect.arrayContaining(['attach', 'handshake', 'workflow-import-media', 'tasks']),
    );
    expect(payload.steps.every((step: { status: string }) => step.status === 'skipped')).toBe(true);
  });

  it('streams NDJSON events for parent agents', () => {
    const output = runCli([
      'smoke',
      '--profile',
      'quick',
      '--dry-run',
      '--ndjson',
    ]);
    const events = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(events.map((event: { type: string }) => event.type)).toEqual([
      'run_started',
      'step_started',
      'step_finished',
      'run_finished',
    ]);
    expect(events.every((event: { schemaVersion: number }) => event.schemaVersion === 1)).toBe(
      true,
    );
  });

  it('returns exit code 2 for invalid profiles', () => {
    const result = spawnSync(
      process.execPath,
      [cliPath, 'smoke', '--profile', 'missing', '--json'],
      {
        cwd: projectRoot,
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown profile');
  });

  it('reports bridge unavailable for app status without a bridge URL', () => {
    const result = runCliJson(['app', 'status', '--json', '--attach-file', 'missing.json'], {
      CNAI_AGENT_BRIDGE_URL: '',
    });

    const payload = JSON.parse(result.stdout);

    expect(result.status).toBe(3);
    expect(payload.type).toBe('bridge_unavailable');
    expect(payload.command).toBe('app_status');
    expect(payload.bridge.configured).toBe(false);
  });

  it('lists planned workflow contracts', () => {
    const payload = JSON.parse(runCli(['workflow', 'list', '--json']));

    expect(payload.type).toBe('workflow_contracts');
    expect(payload.workflows.map((workflow: { id: string }) => workflow.id)).toEqual(
      expect.arrayContaining(['smoke.frontend', 'import-media', 'summarize']),
    );
  });

  it('reads attach files and calls a running bridge with bearer auth', async () => {
    let authorization: string | undefined;
    const server = createServer((req, res) => {
      authorization = req.headers.authorization;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          schemaVersion: 1,
          type: 'app_status',
          status: 'ok',
        }),
      );
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('server did not bind to a TCP port');
    }
    const tempDir = mkdtempSync(resolve(tmpdir(), 'cnai-agent-test-'));
    const attachFile = resolve(tempDir, 'agent-bridge.json');
    writeFileSync(
      attachFile,
      JSON.stringify({
        schemaVersion: 1,
        apiVersion: 1,
        url: `http://127.0.0.1:${address.port}`,
        token: 'test-token',
        pid: 123,
      }),
    );

    const result = await runCliAsync([
      'app',
      'status',
      '--json',
      '--attach-file',
      attachFile,
      '--timeout-ms',
      '2000',
    ]);
    server.close();

    const payload = JSON.parse(result.stdout);
    expect(result.status).toBe(0);
    expect(authorization).toBe('Bearer test-token');
    expect(payload.type).toBe('app_status');
    expect(payload.body.status).toBe('ok');
  });

  it('supports app launch dry-run without starting Tauri', () => {
    const payload = JSON.parse(runCli(['app', 'launch', '--dry-run', '--json', '--port', '0']));

    expect(payload.type).toBe('app_launch');
    expect(payload.status).toBe('skipped');
    expect(payload.env.CNAI_AGENT_BRIDGE).toBe('1');
  });

  it('posts renderer UI actions to the bridge', async () => {
    let requestBody = '';
    const server = createServer((req, res) => {
      req.on('data', (chunk) => {
        requestBody += chunk.toString();
      });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            schemaVersion: 1,
            type: 'ui_action',
            status: 'ok',
            kind: 'click',
          }),
        );
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('server did not bind to a TCP port');
    }
    const tempDir = mkdtempSync(resolve(tmpdir(), 'cnai-agent-test-'));
    const attachFile = resolve(tempDir, 'agent-bridge.json');
    writeFileSync(
      attachFile,
      JSON.stringify({
        schemaVersion: 1,
        apiVersion: 1,
        url: `http://127.0.0.1:${address.port}`,
        token: 'test-token',
        pid: 123,
      }),
    );

    const result = await runCliAsync([
      'ui',
      'click',
      '--target',
      'nav.settings',
      '--json',
      '--attach-file',
      attachFile,
      '--timeout-ms',
      '2000',
    ]);
    server.close();

    const payload = JSON.parse(result.stdout);
    expect(result.status).toBe(0);
    expect(payload.type).toBe('ui_click');
    expect(JSON.parse(requestBody)).toEqual({
      target: 'nav.settings',
      selector: null,
    });
  });

  it('posts app workflow arguments to the bridge', async () => {
    let requestBody = '';
    const server = createServer((req, res) => {
      expect(req.url).toBe('/v1/workflow/import-media');
      req.on('data', (chunk) => {
        requestBody += chunk.toString();
      });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            schemaVersion: 1,
            type: 'workflow_result',
            status: 'ok',
            workflowId: 'import-media',
          }),
        );
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('server did not bind to a TCP port');
    }
    const tempDir = mkdtempSync(resolve(tmpdir(), 'cnai-agent-test-'));
    const attachFile = resolve(tempDir, 'agent-bridge.json');
    writeFileSync(
      attachFile,
      JSON.stringify({
        schemaVersion: 1,
        apiVersion: 1,
        url: `http://127.0.0.1:${address.port}`,
        token: 'test-token',
        pid: 123,
      }),
    );

    const result = await runCliAsync([
      'workflow',
      'import-media',
      '--lecture-id',
      'lecture-1',
      '--file',
      'D:/input/class.mp4',
      '--language',
      'auto',
      '--dry-run',
      '--json',
      '--attach-file',
      attachFile,
      '--timeout-ms',
      '2000',
    ]);
    server.close();

    const payload = JSON.parse(result.stdout);
    expect(result.status).toBe(0);
    expect(payload.type).toBe('workflow_import-media');
    expect(JSON.parse(requestBody)).toEqual(expect.objectContaining({
      lectureId: 'lecture-1',
      file: 'D:/input/class.mp4',
      language: 'auto',
      dryRun: true,
    }));
  });

  it('streams followed bridge events as NDJSON with a max event guard', async () => {
    const server = createServer((req, res) => {
      expect(req.url).toBe('/v1/events?follow=1');
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
      });
      res.write(
        `event: bridge.snapshot\ndata: ${JSON.stringify({
          schemaVersion: 1,
          type: 'event_snapshot',
          status: 'ok',
          events: [],
        })}\n\n`,
      );
      res.write(
        `event: task.started\ndata: ${JSON.stringify({
          id: 2,
          eventType: 'task.started',
          payload: { taskId: 'task-1' },
        })}\n\n`,
      );
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('server did not bind to a TCP port');
    }
    const tempDir = mkdtempSync(resolve(tmpdir(), 'cnai-agent-test-'));
    const attachFile = resolve(tempDir, 'agent-bridge.json');
    writeFileSync(
      attachFile,
      JSON.stringify({
        schemaVersion: 1,
        apiVersion: 1,
        url: `http://127.0.0.1:${address.port}`,
        token: 'test-token',
        pid: 123,
      }),
    );

    const result = await runCliAsync([
      'events',
      'watch',
      '--follow',
      '--ndjson',
      '--max-events',
      '2',
      '--attach-file',
      attachFile,
      '--timeout-ms',
      '5000',
    ]);
    server.close();

    const events = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
    expect(result.status).toBe(0);
    expect(events.map((event: { event: string }) => event.event)).toEqual([
      'bridge.snapshot',
      'task.started',
    ]);
  });

  it('lists bridge tasks through the CLI', async () => {
    const server = createServer((req, res) => {
      expect(req.url).toBe('/v1/tasks');
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          schemaVersion: 1,
          type: 'task_list',
          status: 'ok',
          tasks: [{ id: 'task-1', status: 'completed' }],
        }),
      );
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('server did not bind to a TCP port');
    }
    const tempDir = mkdtempSync(resolve(tmpdir(), 'cnai-agent-test-'));
    const attachFile = resolve(tempDir, 'agent-bridge.json');
    writeFileSync(
      attachFile,
      JSON.stringify({
        schemaVersion: 1,
        apiVersion: 1,
        url: `http://127.0.0.1:${address.port}`,
        token: 'test-token',
        pid: 123,
      }),
    );

    const result = await runCliAsync([
      'tasks',
      'list',
      '--json',
      '--attach-file',
      attachFile,
      '--timeout-ms',
      '2000',
    ]);
    server.close();

    const payload = JSON.parse(result.stdout);
    expect(result.status).toBe(0);
    expect(payload.type).toBe('tasks_list');
    expect(payload.body.tasks[0].id).toBe('task-1');
  });

  it('reads bridge AI readiness through the CLI', async () => {
    const server = createServer((req, res) => {
      expect(req.url).toBe('/v1/config/ai');
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          schemaVersion: 1,
          type: 'ai_config',
          status: 'ok',
          state: { readyForText: true, activeProviderId: 'github-models' },
        }),
      );
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('server did not bind to a TCP port');
    }
    const tempDir = mkdtempSync(resolve(tmpdir(), 'cnai-agent-test-'));
    const attachFile = resolve(tempDir, 'agent-bridge.json');
    writeFileSync(
      attachFile,
      JSON.stringify({
        schemaVersion: 1,
        apiVersion: 1,
        url: `http://127.0.0.1:${address.port}`,
        token: 'test-token',
        pid: 123,
      }),
    );

    const result = await runCliAsync([
      'app',
      'ai-status',
      '--json',
      '--attach-file',
      attachFile,
      '--timeout-ms',
      '2000',
    ]);
    server.close();

    const payload = JSON.parse(result.stdout);
    expect(result.status).toBe(0);
    expect(payload.type).toBe('app_ai_status');
    expect(payload.body.state.readyForText).toBe(true);
  });
});
