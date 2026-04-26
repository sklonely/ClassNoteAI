#!/usr/bin/env node
/**
 * Tauri dev launcher · ephemeral port
 *
 * 啟動 `tauri dev` 但 vite/HMR/CDP 全部用 OS 配發的 free port (而非
 * hard-code 1420/1421/9222)，這樣同一台機器可以同時跑多個 worktree
 * (例如 main + Codex + 此 design branch) 而不會 EADDRINUSE。
 *
 * 啟動流程：
 *   1. 用 net.createServer().listen(0) 從 OS 拿 3 個 free port
 *      (vite + HMR + CDP for WebView2)
 *   2. 把 port 經 env (VITE_DEV_PORT/VITE_HMR_PORT) 傳給 vite.config.ts
 *   3. 設 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<cdp>
 *      讓 webview2 起 CDP，dev-ctl.mjs 能接
 *   4. 把 chosen ports 寫到 .dev-ephemeral.lock.json，dev-ctl.mjs 自動讀
 *   5. spawn `npx tauri dev --config <tmp.json>` 覆寫 build.devUrl
 *
 * 清理：
 *   - 收到 SIGINT/SIGTERM → kill 子進程 (Windows 用 taskkill /T /F killTree)
 *   - 子進程任何理由 exit → wrapper 同步 exit，刪掉 lock + temp config
 *   - 沒有東西會 squat 在固定 port (port 隨機，process 死就釋放)
 *
 * Usage:
 *   npm run dev:ephemeral                  # 一般用法
 *   node scripts/dev-ctl.mjs screenshot    # 自動讀 lock 找到 CDP port
 */

import net from 'node:net';
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const isWindows = process.platform === 'win32';

/** Ask the OS for a free TCP port and immediately release it. */
function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen({ port: 0, host: '127.0.0.1' }, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      srv.close((closeErr) => {
        if (closeErr) reject(closeErr);
        else if (port) resolve(port);
        else reject(new Error('Could not determine free port'));
      });
    });
  });
}

/** Pick N distinct free ports (just-in-case there's any race the OS reuses). */
async function pickFreePorts(n) {
  const seen = new Set();
  const ports = [];
  while (ports.length < n) {
    const p = await pickFreePort();
    if (!seen.has(p)) {
      seen.add(p);
      ports.push(p);
    }
  }
  return ports;
}

/** Cross-platform "kill the whole process tree". */
function killTree(child) {
  if (!child || child.killed) return;
  if (isWindows) {
    // /T = include child processes, /F = force.
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      shell: false,
    });
  } else {
    try {
      // Negative PID = whole process group (we set detached:true below).
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
    }
  }
}

// Lock file lives in cwd so dev-ctl can find it without env vars.
const LOCK_PATH = join(process.cwd(), '.dev-ephemeral.lock.json');

async function main() {
  const [vitePort, hmrPort, cdpPort] = await pickFreePorts(3);
  const devUrl = `http://localhost:${vitePort}`;
  console.log(`[dev-ephemeral] vite=${vitePort}  hmr=${hmrPort}  cdp=${cdpPort}`);
  console.log(`[dev-ephemeral] devUrl=${devUrl}`);

  const env = {
    ...process.env,
    VITE_DEV_PORT: String(vitePort),
    VITE_HMR_PORT: String(hmrPort),
    // WebView2 reads this and exposes a CDP endpoint we can drive via
    // scripts/dev-ctl.mjs (eval / screenshot / click / etc).
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
  };

  // dev-ctl.mjs 找 lock file 來知道 CDP port (而不是 hard-code 9222)。
  writeFileSync(
    LOCK_PATH,
    JSON.stringify({ vitePort, hmrPort, cdpPort, pid: process.pid, devUrl }, null, 2),
    'utf8',
  );

  // tauri 2 接受 --config 傳 JSON 字串或檔案路徑。寫到 temp file
  // 避免在 Windows shell 上要 escape 巢狀引號 (`{"build":...}` 內的 `"`
  // 會被 cmd.exe 吃掉)。
  const tmpDir = mkdtempSync(join(tmpdir(), 'cnai-dev-'));
  const overridePath = join(tmpDir, 'tauri.override.json');
  writeFileSync(
    overridePath,
    JSON.stringify({ build: { devUrl } }, null, 2),
    'utf8',
  );

  const args = ['tauri', 'dev', '--config', overridePath, ...process.argv.slice(2)];
  // Windows 上 spawn .cmd 從 Node 18.20 / 20.12 起須 shell: true (CVE-2024-27980)；
  // 否則 EINVAL。args 內容由我們完全掌控 → 不會 shell-inject。
  const child = spawn('npx', args, {
    stdio: 'inherit',
    env,
    shell: isWindows,
    detached: !isWindows, // Unix: own pgrp so we can kill the tree
  });

  let exiting = false;
  const cleanup = (code) => {
    if (exiting) return;
    exiting = true;
    killTree(child);
    try { unlinkSync(overridePath); } catch { /* best-effort */ }
    try { unlinkSync(LOCK_PATH); } catch { /* best-effort */ }
    process.exit(code ?? 0);
  };

  process.on('SIGINT', () => cleanup(130));
  process.on('SIGTERM', () => cleanup(143));
  process.on('SIGHUP', () => cleanup(129));

  child.on('exit', (code, signal) => {
    if (signal) console.log(`[dev-ephemeral] tauri exited via ${signal}`);
    cleanup(code ?? 0);
  });

  child.on('error', (err) => {
    console.error('[dev-ephemeral] spawn error:', err.message);
    cleanup(1);
  });
}

main().catch((err) => {
  console.error('[dev-ephemeral] fatal:', err.message);
  process.exit(1);
});
