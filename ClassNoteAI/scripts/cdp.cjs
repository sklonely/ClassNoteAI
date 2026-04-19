#!/usr/bin/env node
/**
 * Tiny CDP client for the running Tauri dev app.
 *
 * `tauri.conf.json` now has `devtools: true` + the WebView2 process
 * exposes Chrome DevTools Protocol on 127.0.0.1:9222 while the dev
 * server is running. This wrapper saves the ~20 lines of boilerplate
 * every time you want to peek at the app from the shell / an agent.
 *
 * Usage:
 *   node scripts/cdp.cjs tail                 # stream console logs
 *   node scripts/cdp.cjs tail --grep videoImp # only lines matching
 *   node scripts/cdp.cjs eval '<js>'          # evaluate a JS snippet
 *   node scripts/cdp.cjs text                 # dump body.innerText
 *   node scripts/cdp.cjs screenshot out.png   # save viewport PNG
 *   node scripts/cdp.cjs dom '<selector>'     # outerHTML of first match
 *   node scripts/cdp.cjs sql "<SELECT ...>"   # run a read-only query
 *                                               via window __cdp_sql
 *
 * Default port 9222 can be overridden with CDP_PORT.
 *
 * All subcommands exit 0 on success, 1 on failure so the agent can
 * chain them in Bash.
 */
const fs = require('fs');
const http = require('http');

let WebSocket;
try {
    WebSocket = require('ws');
} catch {
    console.error(
        "This script needs the 'ws' package. Run from the app's project root where ws is already installed, or `npm i ws`.",
    );
    process.exit(1);
}

const PORT = parseInt(process.env.CDP_PORT || '9222', 10);

function httpGetJson(path) {
    return new Promise((resolve, reject) => {
        const url = `http://127.0.0.1:${PORT}${path}`;
        http.get(url, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error(`bad JSON from CDP: ${body.slice(0, 200)}`));
                }
            });
        }).on('error', reject);
    });
}

async function pickPage() {
    const pages = await httpGetJson('/json/list');
    const page = pages.find((p) => p.type === 'page');
    if (!page) throw new Error('no "page" target — is the app running?');
    return page;
}

class CdpSession {
    constructor(ws) {
        this.ws = ws;
        this.id = 1;
        this.pending = new Map();
        this.listeners = [];
        ws.on('message', (m) => {
            let msg;
            try {
                msg = JSON.parse(m.toString());
            } catch {
                return;
            }
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error) reject(new Error(msg.error.message));
                else resolve(msg.result);
            } else if (msg.method) {
                for (const l of this.listeners) l(msg);
            }
        });
    }
    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = this.id++;
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    on(fn) {
        this.listeners.push(fn);
    }
}

async function connect() {
    const page = await pickPage();
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => {
        ws.once('open', r);
        ws.once('error', j);
    });
    return new CdpSession(ws);
}

function serializeConsoleArg(arg) {
    if (arg.value !== undefined) return String(arg.value);
    if (arg.unserializableValue) return arg.unserializableValue;
    if (arg.description) return arg.description;
    return '[unserializable]';
}

function escapeRegExpLiteral(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function cmdTail(flags) {
    const grep = flags.grep ? new RegExp(escapeRegExpLiteral(String(flags.grep))) : null;
    const session = await connect();
    await session.send('Runtime.enable');
    session.on((msg) => {
        if (msg.method === 'Runtime.consoleAPICalled') {
            const { type, args, timestamp } = msg.params;
            const text = (args || []).map(serializeConsoleArg).join(' ');
            const line = `[${new Date(timestamp).toISOString().slice(11, 19)}][${type}] ${text}`;
            if (!grep || grep.test(line)) console.log(line);
        } else if (msg.method === 'Runtime.exceptionThrown') {
            const d = msg.params.exceptionDetails;
            const line = `[EXC] ${d.text} ${d.exception?.description || ''}`;
            if (!grep || grep.test(line)) console.log(line);
        }
    });
    // Keep open until SIGINT.
    process.on('SIGINT', () => process.exit(0));
    console.error(`[cdp] tailing console on :${PORT} (Ctrl-C to stop)`);
    await new Promise(() => {}); // forever
}

async function cmdEval(expr) {
    if (!expr) {
        console.error('usage: cdp.cjs eval <expression>');
        process.exit(1);
    }
    const session = await connect();
    const r = await session.send('Runtime.evaluate', {
        expression: `(async () => { try { const v = await (${expr}); return typeof v === 'string' ? v : JSON.stringify(v, null, 2); } catch (e) { return 'ERR: ' + (e?.stack || String(e)); } })()`,
        awaitPromise: true,
        returnByValue: true,
    });
    if (r.exceptionDetails) {
        console.error(r.exceptionDetails.text);
        process.exit(1);
    }
    console.log(r.result?.value ?? '');
    process.exit(0);
}

async function cmdText() {
    const session = await connect();
    const r = await session.send('Runtime.evaluate', {
        expression: 'document.body.innerText',
        returnByValue: true,
    });
    console.log(r.result?.value || '');
    process.exit(0);
}

async function cmdDom(selector) {
    if (!selector) {
        console.error('usage: cdp.cjs dom <css-selector>');
        process.exit(1);
    }
    const session = await connect();
    const r = await session.send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(selector)})?.outerHTML ?? null`,
        returnByValue: true,
    });
    console.log(r.result?.value || '(no match)');
    process.exit(0);
}

async function cmdScreenshot(outPath) {
    const session = await connect();
    await session.send('Page.enable');
    const r = await session.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(r.data, 'base64');
    const out = outPath || 'cdp-screenshot.png';
    fs.writeFileSync(out, buf);
    console.log(out + ' (' + buf.length + ' bytes)');
    process.exit(0);
}

function parseFlags(argv) {
    const flags = {};
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const val = argv[i + 1];
            if (!val || val.startsWith('--')) {
                flags[key] = true;
            } else {
                flags[key] = val;
                i++;
            }
        } else {
            rest.push(a);
        }
    }
    return { flags, rest };
}

async function main() {
    const [, , cmd, ...raw] = process.argv;
    const { flags, rest } = parseFlags(raw);
    try {
        switch (cmd) {
            case 'tail':
                return cmdTail(flags);
            case 'eval':
                return cmdEval(rest.join(' '));
            case 'text':
                return cmdText();
            case 'dom':
                return cmdDom(rest[0]);
            case 'screenshot':
                return cmdScreenshot(rest[0]);
            default:
                console.error(
                    `Unknown command: ${cmd}\n` +
                        'Available: tail | eval | text | dom | screenshot',
                );
                process.exit(1);
        }
    } catch (err) {
        console.error(err.stack || String(err));
        process.exit(1);
    }
}

main();
