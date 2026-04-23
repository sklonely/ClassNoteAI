import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const GITHUB_CATALOG_ENDPOINT = 'https://models.github.ai/catalog/models';
const GITHUB_INFERENCE_ENDPOINT = 'https://models.github.ai/inference/chat/completions';
const GITHUB_API_VERSION = '2026-03-10';

const CHATGPT_RESPONSES_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const CHATGPT_MODELS_ENDPOINT = 'https://chatgpt.com/backend-api/codex/models';
const CHATGPT_CLIENT_VERSION = '0.1.0';
const CHATGPT_OAUTH_TOKEN = 'https://auth.openai.com/oauth/token';
const CHATGPT_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

const OCR_SYSTEM_PROMPT =
    'You are an OCR engine specialised in academic lecture slides. ' +
    'Extract ALL visible text faithfully. Output plain text only, no commentary.';

type ProviderId = 'github-models' | 'chatgpt-oauth';
type ImageFormat = 'jpeg' | 'png';

interface Options {
    providers: ProviderId[];
    pdfPath: string;
    page: number;
    expect: string[];
    model?: string;
    json: boolean;
    keepArtifacts: boolean;
    imageFormat: ImageFormat;
    prompt: string;
}

interface SmokeResult {
    provider: ProviderId;
    authSource: string;
    model: string;
    page: number;
    output: string;
    ok: boolean;
    missingExpectations: string[];
    durationMs: number;
    artifactPath?: string;
}

interface ProviderModel {
    id: string;
    vision?: boolean;
}

interface ChatGptTokens {
    accessToken: string;
    refreshToken?: string;
    source: string;
}

function printUsage(): void {
    console.log(`
Usage:
  npm run smoke:ocr -- --provider all --pdf /abs/path/file.pdf --page 1 --expect "Database Management Systems"

Options:
  --provider <github-models|chatgpt-oauth|all>  Provider to test. Default: all
  --pdf <path>                                  Absolute or relative path to a PDF
  --page <n>                                    1-based page number. Default: 1
  --expect <text>                               Expected substring in OCR output. Repeatable.
  --model <id>                                  Override auto-selected model id
  --image-format <jpeg|png>                     Render format for the OCR request. Default: jpeg
  --prompt <text>                               Override the default OCR user prompt
  --json                                        Emit machine-readable JSON
  --keep-artifacts                              Keep rendered page image on disk
  --help                                        Show this help

Auth resolution:
  github-models:
    1. GITHUB_MODELS_PAT
    2. gh auth token

  chatgpt-oauth:
    1. CHATGPT_ACCESS_TOKEN / CHATGPT_REFRESH_TOKEN
    2. ~/.codex/auth.json (tokens.access_token / tokens.refresh_token)
`);
}

function parseArgs(argv: string[]): Options {
    let providerArg = 'all';
    let pdfPath = '';
    let page = 1;
    const expect: string[] = [];
    let model: string | undefined;
    let json = false;
    let keepArtifacts = false;
    let imageFormat: ImageFormat = 'jpeg';
    let prompt = 'OCR this lecture slide. Return the visible text only.';

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        switch (arg) {
            case '--provider':
                providerArg = argv[++index] ?? '';
                break;
            case '--pdf':
                pdfPath = argv[++index] ?? '';
                break;
            case '--page':
                page = Number(argv[++index] ?? '1');
                break;
            case '--expect':
                expect.push(argv[++index] ?? '');
                break;
            case '--model':
                model = argv[++index] ?? '';
                break;
            case '--image-format': {
                const value = argv[++index] ?? '';
                if (value !== 'jpeg' && value !== 'png') {
                    throw new Error(`Unsupported --image-format: ${value}`);
                }
                imageFormat = value;
                break;
            }
            case '--prompt':
                prompt = argv[++index] ?? prompt;
                break;
            case '--json':
                json = true;
                break;
            case '--keep-artifacts':
                keepArtifacts = true;
                break;
            case '--help':
            case '-h':
                printUsage();
                process.exit(0);
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!pdfPath) throw new Error('Missing required --pdf <path>');
    if (!Number.isInteger(page) || page <= 0) throw new Error(`Invalid --page value: ${page}`);

    const providers =
        providerArg === 'all'
            ? (['github-models', 'chatgpt-oauth'] as ProviderId[])
            : [providerArg as ProviderId];

    for (const provider of providers) {
        if (provider !== 'github-models' && provider !== 'chatgpt-oauth') {
            throw new Error(`Unsupported provider: ${provider}`);
        }
    }

    return {
        providers,
        pdfPath,
        page,
        expect: expect.filter(Boolean),
        model: model || undefined,
        json,
        keepArtifacts,
        imageFormat,
        prompt,
    };
}

function excerpt(text: string, max = 160): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max - 1)}…`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    return response.json() as Promise<T>;
}

async function renderPdfPage(
    pdfPath: string,
    page: number,
    imageFormat: ImageFormat,
): Promise<{ dataUrl: string; artifactPath: string; cleanup: () => Promise<void> }> {
    const tempDir = await mkdtemp(join(tmpdir(), 'classnoteai-ocr-smoke-'));
    const outputBase = join(tempDir, 'page');
    const extension = imageFormat === 'jpeg' ? 'jpg' : 'png';
    const outputPath = `${outputBase}.${extension}`;

    const args = [
        imageFormat === 'jpeg' ? '-jpeg' : '-png',
        '-f',
        String(page),
        '-l',
        String(page),
        '-singlefile',
        '-scale-to',
        '1280',
        pdfPath,
        outputBase,
    ];

    try {
        await execFile('pdftoppm', args);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Failed to render PDF page via pdftoppm. Install poppler and ensure pdftoppm is on PATH. ${message}`,
        );
    }

    const bytes = await readFile(outputPath);
    const mime = imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
    const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;

    return {
        dataUrl,
        artifactPath: outputPath,
        cleanup: async () => {
            await rm(tempDir, { recursive: true, force: true });
        },
    };
}

async function resolveGitHubToken(): Promise<{ token: string; source: string }> {
    if (process.env.GITHUB_MODELS_PAT?.trim()) {
        return { token: process.env.GITHUB_MODELS_PAT.trim(), source: 'env:GITHUB_MODELS_PAT' };
    }
    try {
        const { stdout } = await execFile('gh', ['auth', 'token']);
        const token = stdout.trim();
        if (token) return { token, source: 'gh auth token' };
    } catch {
        // fall through
    }
    throw new Error('No GitHub Models token found. Set GITHUB_MODELS_PAT or log in via `gh auth login`.');
}

async function readCodexAuthFile(): Promise<ChatGptTokens | null> {
    const authPath = join(homedir(), '.codex', 'auth.json');
    try {
        const raw = JSON.parse(await readFile(authPath, 'utf-8')) as {
            tokens?: { access_token?: string; refresh_token?: string };
        };
        const accessToken = raw.tokens?.access_token?.trim();
        if (!accessToken) return null;
        const refreshToken = raw.tokens?.refresh_token?.trim();
        return {
            accessToken,
            refreshToken: refreshToken || undefined,
            source: '~/.codex/auth.json',
        };
    } catch {
        return null;
    }
}

async function refreshChatGptAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const form = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CHATGPT_OAUTH_CLIENT_ID,
    });

    const response = await fetch(CHATGPT_OAUTH_TOKEN, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
        body: form.toString(),
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`ChatGPT token refresh failed: HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    const data = (await response.json()) as { access_token?: string; refresh_token?: string };
    if (!data.access_token) throw new Error('ChatGPT token refresh response missing access_token');
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? refreshToken,
    };
}

async function resolveChatGptTokens(): Promise<ChatGptTokens> {
    if (process.env.CHATGPT_ACCESS_TOKEN?.trim()) {
        return {
            accessToken: process.env.CHATGPT_ACCESS_TOKEN.trim(),
            refreshToken: process.env.CHATGPT_REFRESH_TOKEN?.trim() || undefined,
            source: 'env:CHATGPT_ACCESS_TOKEN',
        };
    }

    const fromCodex = await readCodexAuthFile();
    if (fromCodex) return fromCodex;

    throw new Error(
        'No ChatGPT OAuth token found. Set CHATGPT_ACCESS_TOKEN/CHATGPT_REFRESH_TOKEN or sign in with Codex CLI.',
    );
}

function inferGitHubVisionCapability(row: { id: string; capabilities?: string[] }): boolean | undefined {
    const caps = (row.capabilities ?? []).map((capability) => capability.toLowerCase());
    if (caps.some((capability) => capability.includes('vision') || capability.includes('image'))) {
        return true;
    }
    if (
        row.id === 'openai/gpt-4o' ||
        row.id === 'openai/gpt-4o-mini' ||
        row.id === 'openai/gpt-4.1' ||
        row.id === 'openai/gpt-4.1-mini'
    ) {
        return true;
    }
    return undefined;
}

function pickPreferredVisionModel(models: ProviderModel[], preferred?: string): string {
    const visionModels = models.filter((model) => model.vision);
    if (visionModels.length === 0) throw new Error('Provider exposes no vision-capable model.');

    if (preferred) {
        const exact = visionModels.find((model) => model.id === preferred);
        if (exact) return exact.id;
        throw new Error(`Requested model ${preferred} is not vision-capable or not available.`);
    }

    const order = [
        'openai/gpt-4o-mini',
        'openai/gpt-4o',
        'openai/gpt-4.1-mini',
        'openai/gpt-4.1',
        'gpt-4o-mini',
        'gpt-4o',
        'gpt-4.1-mini',
        'gpt-4.1',
    ];
    for (const candidate of order) {
        const hit = visionModels.find((model) => model.id === candidate);
        if (hit) return hit.id;
    }
    return visionModels[0].id;
}

async function listGitHubModels(token: string): Promise<ProviderModel[]> {
    const rows = await fetchJson<Array<{ id: string; capabilities?: string[] }>>(GITHUB_CATALOG_ENDPOINT, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': GITHUB_API_VERSION,
        },
    });
    return rows.map((row) => ({ id: row.id, vision: inferGitHubVisionCapability(row) }));
}

async function listChatGptModels(accessToken: string): Promise<ProviderModel[]> {
    const url = `${CHATGPT_MODELS_ENDPOINT}?client_version=${encodeURIComponent(CHATGPT_CLIENT_VERSION)}`;
    const data = await fetchJson<{ models?: Array<{ slug?: string; input_modalities?: string[] }> }>(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
        },
    });
    return (data.models ?? [])
        .map((model) => ({
            id: model.slug ?? 'unknown',
            vision: (model.input_modalities ?? []).includes('image'),
        }))
        .filter((model) => model.id !== 'unknown');
}

async function runGitHubOcr(
    token: string,
    model: string,
    dataUrl: string,
    prompt: string,
): Promise<string> {
    const response = await fetch(GITHUB_INFERENCE_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: OCR_SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
                    ],
                },
            ],
            max_tokens: 512,
            temperature: 0,
        }),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`GitHub Models OCR failed: HTTP ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? '';
}

async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, void> {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let idx = buffer.indexOf('\n\n');
            while (idx !== -1) {
                const eventText = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                for (const line of eventText.split(/\r?\n/)) {
                    if (!line || line.startsWith(':')) continue;
                    const colon = line.indexOf(':');
                    const field = colon === -1 ? line : line.slice(0, colon);
                    const data = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
                    if (field === 'data') {
                        if (data === '[DONE]') return;
                        yield data;
                    }
                }
                idx = buffer.indexOf('\n\n');
            }
        }
    } finally {
        reader.releaseLock();
    }
}

async function runChatGptOcrWithToken(accessToken: string, model: string, dataUrl: string, prompt: string): Promise<string> {
    const response = await fetch(CHATGPT_RESPONSES_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'OpenAI-Beta': 'responses=v1',
            originator: 'codex_cli_rs',
        },
        body: JSON.stringify({
            model,
            input: [
                {
                    role: 'user',
                    content: [
                        { type: 'input_text', text: prompt },
                        { type: 'input_image', image_url: dataUrl, detail: 'high' },
                    ],
                },
            ],
            store: false,
            stream: true,
            instructions: OCR_SYSTEM_PROMPT,
            include: ['reasoning.encrypted_content'],
        }),
    });

    if (!response.ok || !response.body) {
        const body = await response.text().catch(() => '');
        throw new Error(`ChatGPT OCR failed: HTTP ${response.status}: ${body.slice(0, 300)}`);
    }

    let text = '';
    for await (const payload of parseSSE(response.body)) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(payload);
        } catch {
            continue;
        }
        const event = parsed as { type?: string; delta?: string; response?: { status?: string } };
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
            text += event.delta;
        }
        if (event.type === 'response.failed' || event.type === 'error') {
            throw new Error(`ChatGPT OCR stream failed: ${payload.slice(0, 300)}`);
        }
    }
    return text.trim();
}

async function runChatGptOcr(tokens: ChatGptTokens, model: string, dataUrl: string, prompt: string): Promise<string> {
    try {
        return await runChatGptOcrWithToken(tokens.accessToken, model, dataUrl, prompt);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/HTTP 401|HTTP 403/i.test(message) || !tokens.refreshToken) {
            throw error;
        }
        const refreshed = await refreshChatGptAccessToken(tokens.refreshToken);
        return runChatGptOcrWithToken(refreshed.accessToken, model, dataUrl, prompt);
    }
}

async function smokeProvider(
    provider: ProviderId,
    options: Options,
    dataUrl: string,
    artifactPath?: string,
): Promise<SmokeResult> {
    const startedAt = Date.now();
    if (provider === 'github-models') {
        const { token, source } = await resolveGitHubToken();
        const models = await listGitHubModels(token);
        const model = pickPreferredVisionModel(models, options.model);
        const output = await runGitHubOcr(token, model, dataUrl, options.prompt);
        const missingExpectations = options.expect.filter(
            (needle) => !output.toLowerCase().includes(needle.toLowerCase()),
        );
        return {
            provider,
            authSource: source,
            model,
            page: options.page,
            output,
            ok: output.trim().length > 0 && missingExpectations.length === 0,
            missingExpectations,
            durationMs: Date.now() - startedAt,
            artifactPath,
        };
    }

    const tokens = await resolveChatGptTokens();
    const models = await listChatGptModels(tokens.accessToken).catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!/HTTP 401|HTTP 403/i.test(message) || !tokens.refreshToken) throw error;
        const refreshed = await refreshChatGptAccessToken(tokens.refreshToken);
        return listChatGptModels(refreshed.accessToken);
    });
    const model = pickPreferredVisionModel(models, options.model);
    const output = await runChatGptOcr(tokens, model, dataUrl, options.prompt);
    const missingExpectations = options.expect.filter(
        (needle) => !output.toLowerCase().includes(needle.toLowerCase()),
    );
    return {
        provider,
        authSource: tokens.source,
        model,
        page: options.page,
        output,
        ok: output.trim().length > 0 && missingExpectations.length === 0,
        missingExpectations,
        durationMs: Date.now() - startedAt,
        artifactPath,
    };
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const rendered = await renderPdfPage(options.pdfPath, options.page, options.imageFormat);
    try {
        const results: SmokeResult[] = [];
        for (const provider of options.providers) {
            // eslint-disable-next-line no-await-in-loop
            results.push(
                await smokeProvider(
                    provider,
                    options,
                    rendered.dataUrl,
                    options.keepArtifacts ? rendered.artifactPath : undefined,
                ),
            );
        }

        const payload = {
            pdfPath: options.pdfPath,
            page: options.page,
            imageFormat: options.imageFormat,
            expectations: options.expect,
            results,
        };

        if (options.json) {
            console.log(JSON.stringify(payload, null, 2));
        } else {
            for (const result of results) {
                console.log(
                    `[ocr-smoke] ${result.provider} ${result.ok ? 'PASS' : 'FAIL'} ` +
                    `model=${result.model} auth=${result.authSource} page=${result.page} ` +
                    `elapsed=${result.durationMs}ms`,
                );
                console.log(`  excerpt: ${excerpt(result.output) || '(empty)'}`);
                if (result.missingExpectations.length > 0) {
                    console.log(`  missing: ${result.missingExpectations.join(' | ')}`);
                }
                if (result.artifactPath) {
                    console.log(`  image: ${result.artifactPath}`);
                }
            }
        }

        if (results.some((result) => !result.ok)) {
            process.exitCode = 1;
        }
    } finally {
        if (!options.keepArtifacts) {
            await rendered.cleanup();
        }
    }
}

main().catch((error) => {
    console.error('[smoke:ocr] fatal:', error instanceof Error ? error.message : String(error));
    process.exit(1);
});
