#!/usr/bin/env node
/**
 * Tauri-dev remote control via Chrome DevTools Protocol.
 *
 * The Tauri dev binary must have been launched with
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
 * (see scripts/win-tauri-dev.bat). This script connects to 9222 and
 * drives the WebView2 page: screenshot, click, type, eval JS, tail
 * console, dump DOM.
 *
 * Usage:
 *   node scripts/dev-ctl.mjs screenshot [outPath]      → full viewport PNG
 *   node scripts/dev-ctl.mjs full-screenshot [outPath] → full page PNG
 *   node scripts/dev-ctl.mjs eval '<js>'               → runs JS, prints JSON
 *   node scripts/dev-ctl.mjs click '<css-selector>'    → clicks first match
 *   node scripts/dev-ctl.mjs type '<selector>' '<txt>' → fills input (incl. React controlled)
 *   node scripts/dev-ctl.mjs dom ['<selector>']        → outerHTML of selector (or whole body)
 *   node scripts/dev-ctl.mjs text ['<selector>']       → textContent
 *   node scripts/dev-ctl.mjs url                       → current URL + title
 *   node scripts/dev-ctl.mjs nav '<url>'               → navigate
 *   node scripts/dev-ctl.mjs console [--follow]        → print console messages (live if --follow)
 *   node scripts/dev-ctl.mjs network [--follow]        → print network requests (live if --follow)
 *   node scripts/dev-ctl.mjs wait '<selector>' [ms]    → wait for selector to exist
 *   node scripts/dev-ctl.mjs reload                    → Ctrl-R the page
 *
 * Exit code: 0 on success, non-zero on any failure.
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

// Resolve CDP port: explicit env wins; otherwise read .dev-ephemeral.lock.json
// (written by scripts/dev-ephemeral.mjs); otherwise fall back to 9222 (the
// historical fixed port from win-tauri-dev.bat).
function resolveCdpPort() {
  if (process.env.CDP_PORT) return parseInt(process.env.CDP_PORT, 10);
  const lock = join(process.cwd(), ".dev-ephemeral.lock.json");
  if (existsSync(lock)) {
    try {
      const data = JSON.parse(readFileSync(lock, "utf8"));
      if (typeof data?.cdpPort === "number") return data.cdpPort;
    } catch {
      /* fall through */
    }
  }
  return 9222;
}

const PORT = resolveCdpPort();
const HOST = process.env.CDP_HOST || "127.0.0.1";

// ---------- CDP client ---------------------------------------------------

class CDP {
  /** @type {WebSocket | null} */
  ws = null;
  nextId = 1;
  /** @type {Map<number, {resolve:(v:any)=>void, reject:(e:any)=>void}>} */
  pending = new Map();
  /** @type {Map<string, Array<(params:any)=>void>>} */
  listeners = new Map();
  closed = false;

  async connect() {
    const targets = await this._fetchJSON(`http://${HOST}:${PORT}/json`);
    // Prefer the real app page (http/https), not a devtools:// target that
    // also lives under the same CDP port once the user opens DevTools.
    const isAppPage = (t) =>
      t.type === "page" &&
      t.webSocketDebuggerUrl &&
      typeof t.url === "string" &&
      (t.url.startsWith("http://") || t.url.startsWith("https://")) &&
      !t.url.startsWith("devtools://");
    const target =
      targets.find(isAppPage) ||
      targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl) ||
      targets.find((t) => t.webSocketDebuggerUrl);
    if (!target) {
      throw new Error(
        `No CDP target with WebSocket debugger URL at ${HOST}:${PORT}. Is dev app launched with --remote-debugging-port=${PORT}?`
      );
    }
    await new Promise((res, rej) => {
      this.ws = new WebSocket(target.webSocketDebuggerUrl);
      this.ws.onopen = () => res();
      this.ws.onerror = (e) => rej(new Error(`WebSocket error: ${e.message ?? e}`));
      this.ws.onclose = () => {
        this.closed = true;
      };
      this.ws.onmessage = (m) => this._onMessage(typeof m.data === "string" ? m.data : String(m.data));
    });
  }

  async _fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    return res.json();
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.method) {
      for (const cb of this.listeners.get(msg.method) ?? []) {
        try {
          cb(msg.params);
        } catch (e) {
          // Use positional args instead of a template-literal format
          // string. CodeQL flagged the previous form
          // (`console.error(\`... ${msg.method} ...\`, e)`) as
          // "externally-controlled format string" — msg.method comes
          // from the CDP websocket and could theoretically contain
          // printf-style specifiers (%s, %d) that console.error honours
          // before the ...rest args are consumed. Impact on a dev-only
          // script is nil, but an import for linter-happy commit.
          console.error('[dev-ctl] listener threw:', msg.method, e);
        }
      }
    }
  }

  /** Send a CDP command and await its result. */
  send(method, params = {}) {
    if (!this.ws || this.closed) return Promise.reject(new Error("CDP not connected"));
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
    });
  }

  on(eventName, handler) {
    const arr = this.listeners.get(eventName) ?? [];
    arr.push(handler);
    this.listeners.set(eventName, arr);
  }

  close() {
    if (this.ws && !this.closed) this.ws.close();
  }
}

// ---------- Helpers ------------------------------------------------------

async function attachDOM(cdp) {
  await cdp.send("Runtime.enable");
  await cdp.send("DOM.enable");
  await cdp.send("Page.enable");
}

async function evalJS(cdp, expression, { awaitPromise = true, returnByValue = true } = {}) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue,
    allowUnsafeEvalBlockedByCSP: true,
    userGesture: true,
  });
  if (exceptionDetails) {
    const text =
      exceptionDetails.exception?.description ??
      exceptionDetails.text ??
      JSON.stringify(exceptionDetails);
    throw new Error(`JS exception: ${text}`);
  }
  return result;
}

function cssEscape(sel) {
  // We only need to embed it in a JS string. Escape backslash + quote.
  return sel.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

async function waitForSelector(cdp, selector, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const s = cssEscape(selector);
  while (Date.now() < deadline) {
    const r = await evalJS(cdp, `!!document.querySelector('${s}')`);
    if (r?.value === true) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Selector not found within ${timeoutMs} ms: ${selector}`);
}

// ---------- Commands -----------------------------------------------------

async function cmdScreenshot(cdp, outArg, fullPage = false) {
  await cdp.send("Page.enable");
  const params = {
    format: "png",
    captureBeyondViewport: fullPage,
  };
  if (fullPage) {
    const { cssVisualViewport, cssContentSize } = await cdp.send("Page.getLayoutMetrics");
    const w = Math.ceil(cssContentSize?.width ?? cssVisualViewport.clientWidth);
    const h = Math.ceil(cssContentSize?.height ?? cssVisualViewport.clientHeight);
    params.clip = { x: 0, y: 0, width: w, height: h, scale: 1 };
  }
  const { data } = await cdp.send("Page.captureScreenshot", params);
  const buf = Buffer.from(data, "base64");
  const outPath = resolve(outArg || defaultScreenshotPath());
  writeFileSync(outPath, buf);
  console.log(outPath);
}

function defaultScreenshotPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `C:/Users/${process.env.USERNAME}/AppData/Local/Temp/cnai-screenshot-${stamp}.png`;
}

async function cmdEval(cdp, js) {
  const r = await evalJS(cdp, js);
  if (r?.type === "undefined") return;
  const out = r?.value !== undefined ? r.value : r;
  console.log(typeof out === "string" ? out : JSON.stringify(out, null, 2));
}

async function cmdClick(cdp, selector) {
  await waitForSelector(cdp, selector);
  const s = cssEscape(selector);
  await evalJS(
    cdp,
    `(() => {
      const el = document.querySelector('${s}');
      if (!el) throw new Error('missing');
      el.scrollIntoView({block: 'center'});
      // Use a real MouseEvent so React synthetic-event handlers fire.
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        el.dispatchEvent(new MouseEvent(t, {bubbles:true, cancelable:true, view:window, button:0}))
      );
    })()`
  );
}

async function cmdType(cdp, selector, text) {
  await waitForSelector(cdp, selector);
  const s = cssEscape(selector);
  const t = text.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  await evalJS(
    cdp,
    `(() => {
      const el = document.querySelector('${s}');
      if (!el) throw new Error('missing');
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value')?.set;
      if (setter) setter.call(el, '${t}'); else el.value = '${t}';
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
    })()`
  );
}

async function cmdDOM(cdp, selector) {
  const s = selector ? cssEscape(selector) : "body";
  const expr = selector
    ? `document.querySelector('${s}')?.outerHTML ?? null`
    : `document.body.outerHTML`;
  const r = await evalJS(cdp, expr);
  if (r?.value == null) {
    console.error("(no match)");
    process.exit(1);
  }
  console.log(r.value);
}

async function cmdText(cdp, selector) {
  const s = selector ? cssEscape(selector) : "body";
  const expr = selector
    ? `document.querySelector('${s}')?.textContent ?? null`
    : `document.body.textContent`;
  const r = await evalJS(cdp, expr);
  console.log(r?.value ?? "");
}

async function cmdURL(cdp) {
  const r = await evalJS(cdp, "({url: location.href, title: document.title})");
  console.log(JSON.stringify(r.value, null, 2));
}

async function cmdNav(cdp, url) {
  await cdp.send("Page.enable");
  await cdp.send("Page.navigate", { url });
}

async function cmdReload(cdp) {
  await cdp.send("Page.enable");
  await cdp.send("Page.reload");
}

async function cmdConsole(cdp, follow) {
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  const format = (params) => {
    const lvl = (params.type || params.entry?.level || "log").toUpperCase();
    const args = params.args?.map((a) => a.value ?? a.description ?? JSON.stringify(a.preview)).join(" ");
    const text = args ?? params.entry?.text ?? "";
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[${ts}] [${lvl}] ${text}`);
  };
  cdp.on("Runtime.consoleAPICalled", format);
  cdp.on("Log.entryAdded", (p) => format({ entry: p.entry }));
  if (!follow) {
    // One-shot: grab recent buffered entries and exit.
    setTimeout(() => process.exit(0), 500);
  } else {
    console.log("[dev-ctl] tailing console; Ctrl-C to stop");
  }
}

async function cmdNetwork(cdp, follow) {
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", (p) => {
    console.log(`→ ${p.request.method} ${p.request.url}`);
  });
  cdp.on("Network.responseReceived", (p) => {
    console.log(`← ${p.response.status} ${p.response.url}`);
  });
  cdp.on("Network.loadingFailed", (p) => {
    console.log(`✗ ${p.errorText} ${p.requestId}`);
  });
  if (!follow) {
    setTimeout(() => process.exit(0), 500);
  } else {
    console.log("[dev-ctl] tailing network; Ctrl-C to stop");
  }
}

async function cmdWait(cdp, selector, timeoutStr) {
  const timeout = timeoutStr ? parseInt(timeoutStr, 10) : 10000;
  await waitForSelector(cdp, selector, timeout);
}

// ---------- main ---------------------------------------------------------

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd) {
    console.error(
      "usage: dev-ctl.mjs <screenshot|full-screenshot|eval|click|type|dom|text|url|nav|reload|console|network|wait> [...args]"
    );
    process.exit(2);
  }

  const cdp = new CDP();
  try {
    await cdp.connect();
    await attachDOM(cdp);

    switch (cmd) {
      case "screenshot":
        await cmdScreenshot(cdp, rest[0], false);
        break;
      case "full-screenshot":
        await cmdScreenshot(cdp, rest[0], true);
        break;
      case "eval":
        if (!rest[0]) throw new Error("eval requires a JS expression");
        await cmdEval(cdp, rest.join(" "));
        break;
      case "click":
        if (!rest[0]) throw new Error("click requires a selector");
        await cmdClick(cdp, rest[0]);
        break;
      case "type":
        if (rest.length < 2) throw new Error("type requires <selector> <text>");
        await cmdType(cdp, rest[0], rest.slice(1).join(" "));
        break;
      case "dom":
        await cmdDOM(cdp, rest[0]);
        break;
      case "text":
        await cmdText(cdp, rest[0]);
        break;
      case "url":
        await cmdURL(cdp);
        break;
      case "nav":
        if (!rest[0]) throw new Error("nav requires a url");
        await cmdNav(cdp, rest[0]);
        break;
      case "reload":
        await cmdReload(cdp);
        break;
      case "console": {
        const follow = rest.includes("--follow");
        await cmdConsole(cdp, follow);
        if (follow) return; // keep alive
        break;
      }
      case "network": {
        const follow = rest.includes("--follow");
        await cmdNetwork(cdp, follow);
        if (follow) return;
        break;
      }
      case "wait":
        if (!rest[0]) throw new Error("wait requires a selector");
        await cmdWait(cdp, rest[0], rest[1]);
        break;
      default:
        throw new Error(`unknown command: ${cmd}`);
    }
  } catch (e) {
    console.error(`[dev-ctl] ${e.message}`);
    process.exit(1);
  } finally {
    cdp.close();
  }
}

main();
