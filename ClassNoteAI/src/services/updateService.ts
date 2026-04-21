/**
 * Update Service
 * 
 * Handles application updates using Tauri's updater plugin.
 * Supports both automatic and manual update checks.
 */

import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { openPath } from '@tauri-apps/plugin-opener';
import { writeFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { fetch } from '@tauri-apps/plugin-http';
import { downloadDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { storageService } from './storageService';

export type ReleaseChannel = 'stable' | 'beta' | 'alpha';

// Subset of GitHub's release JSON we actually consume.
interface GithubRelease {
    tag_name: string;
    name: string;
    prerelease: boolean;
    draft: boolean;
    published_at: string;
    body: string | null;
    assets: { name: string; browser_download_url: string }[];
}

const GITHUB_API_RELEASES_URL =
    'https://api.github.com/repos/sklonely/ClassNoteAI/releases?per_page=30';

/**
 * v0.6.1: the updater's `target` must match the platform key in the
 * merged `latest.json`. Default Tauri mapping is `windows-x86_64` /
 * `darwin-aarch64` etc., but we now ship two Windows variants (CPU vs
 * CUDA). The CUDA binary reports build variant "cuda" via a compile-
 * time cfg and we append `-cuda` to the platform key so the updater
 * pulls the right artifact.
 *
 * macOS has a single build (Metal always on via `cfg(target_os =
 * "macos")`) so no suffix needed. Returning undefined lets the plugin
 * use its default auto-detected target.
 */
async function pickUpdaterTarget(): Promise<string | undefined> {
    let variant: string;
    try {
        variant = await invoke<string>('get_build_variant');
    } catch {
        // Older binary without the command — fall back to default
        // Tauri auto-detection.
        return undefined;
    }
    switch (variant) {
        case 'cuda':
            return 'windows-x86_64-cuda';
        case 'vulkan':
            // Reserved for when we ship Windows/Linux Vulkan builds.
            return 'windows-x86_64-vulkan';
        case 'metal':
        case 'cpu':
        default:
            return undefined; // auto-detect
    }
}

export interface UpdateInfo {
    available: boolean;
    version?: string;
    body?: string;
    date?: string;
}

export interface UpdateProgress {
    downloaded: number;
    total: number;
    percentage: number;
}

class UpdateService {
    private currentUpdate: Update | null = null;
    // Non-stable channel flow bypasses the updater plugin (no runtime
    // endpoint override). Stash the matched release here so
    // downloadAndInstall can pick the right asset without refetching.
    private pendingChannelRelease: GithubRelease | null = null;

    /**
     * Which release channel the user is subscribed to. Defaults to
     * `stable` on any read failure — we never want a storage hiccup to
     * silently shift the user onto prereleases.
     */
    async getReleaseChannel(): Promise<ReleaseChannel> {
        try {
            const settings = await storageService.getAppSettings();
            const channel = settings?.updates?.channel;
            if (channel === 'beta' || channel === 'alpha') return channel;
            return 'stable';
        } catch {
            return 'stable';
        }
    }

    async setReleaseChannel(channel: ReleaseChannel): Promise<void> {
        const settings = (await storageService.getAppSettings()) ?? ({} as any);
        const next = { ...settings, updates: { ...(settings.updates ?? {}), channel } };
        await storageService.saveAppSettings(next);
    }

    /**
     * Check for available updates on the currently selected channel.
     * - `stable` uses the Tauri updater plugin (signed, auto-install).
     * - `beta` / `alpha` query GitHub's releases API and hand off the
     *   matching release's installer to a manual download+open flow.
     */
    async checkForUpdates(): Promise<UpdateInfo> {
        if (import.meta.env.DEV) {
            console.log('[UpdateService] Running in development mode, updates disabled.');
            return { available: false };
        }

        const channel = await this.getReleaseChannel();
        this.pendingChannelRelease = null;
        this.currentUpdate = null;

        if (channel === 'stable') {
            return this.checkViaPlugin();
        }
        return this.checkViaGithubApi(channel);
    }

    private async checkViaPlugin(): Promise<UpdateInfo> {
        try {
            const target = await pickUpdaterTarget();
            console.log(
                '[UpdateService] Checking for updates (stable channel)...',
                target ? `(target=${target})` : '(default target)',
            );
            const update = await check(target ? { target } : undefined);

            if (update) {
                this.currentUpdate = update;
                console.log(`[UpdateService] Update available: ${update.version}`);
                return {
                    available: true,
                    version: update.version,
                    body: update.body ?? undefined,
                    date: update.date ?? undefined,
                };
            }

            console.log('[UpdateService] No updates available');
            return { available: false };
        } catch (error) {
            console.error('[UpdateService] Failed to check for updates:', error);
            if (error instanceof Error) {
                if (error.message.includes('Network')) {
                    throw new Error('無法連接到更新伺服器，請檢查網路連線。');
                }
            }
            throw error;
        }
    }

    private async checkViaGithubApi(channel: 'beta' | 'alpha'): Promise<UpdateInfo> {
        console.log(`[UpdateService] Checking for updates (${channel} channel) via GitHub API...`);
        let releases: GithubRelease[];
        try {
            const resp = await fetch(GITHUB_API_RELEASES_URL, {
                method: 'GET',
                headers: { 'Accept': 'application/vnd.github+json' },
            });
            if (!resp.ok) {
                throw new Error(`GitHub API returned ${resp.status} ${resp.statusText}`);
            }
            releases = await resp.json();
        } catch (error) {
            console.error('[UpdateService] GitHub API fetch failed:', error);
            if (error instanceof Error && error.message.includes('Network')) {
                throw new Error('無法連接到更新伺服器，請檢查網路連線。');
            }
            throw new Error('無法從 GitHub 取得 release 清單，請稍後再試。');
        }

        // `beta` = stable releases + explicit `*-beta*` tags.
        // `alpha` = stable + any prerelease (alpha, beta, rc, etc.).
        const matching = releases.filter((r) => {
            if (r.draft) return false;
            if (!r.prerelease) return true;
            const tag = r.tag_name.toLowerCase();
            if (channel === 'alpha') return true;
            return tag.includes('-beta');
        });

        if (matching.length === 0) {
            return { available: false };
        }

        // GitHub sorts `/releases` newest-first by created_at.
        const newest = matching[0];
        const newestVersion = stripTagPrefix(newest.tag_name);
        const current = await getVersion();

        if (!isVersionNewer(newestVersion, current)) {
            console.log(
                `[UpdateService] Current ${current} is at or ahead of newest ${channel} ${newestVersion}.`,
            );
            return { available: false };
        }

        this.pendingChannelRelease = newest;
        console.log(`[UpdateService] ${channel} update available: ${newestVersion}`);
        return {
            available: true,
            version: newestVersion,
            body: newest.body ?? undefined,
            date: newest.published_at,
        };
    }

    /**
     * Download and install the update with progress callback.
     * Stable channel → Tauri updater plugin (signed, auto-install +
     * relaunch). Beta/Alpha channel → manual download of the release
     * installer asset, open it for the user to click through.
     */
    async downloadAndInstall(
        onProgress?: (progress: UpdateProgress) => void
    ): Promise<void> {
        if (this.pendingChannelRelease) {
            await this.downloadAndOpenChannelInstaller(
                this.pendingChannelRelease,
                onProgress,
            );
            return;
        }

        if (!this.currentUpdate) {
            throw new Error('No update available. Call checkForUpdates first.');
        }

        try {
            let downloaded = 0;
            let contentLength = 0;

            console.log('[UpdateService] Starting download...');

            // Create a timeout promise (5 minutes)
            const timeoutPromise = new Promise<void>((_, reject) => {
                setTimeout(() => reject(new Error('Update download timed out (300s).')), 300000);
            });

            // Race between download and timeout
            await Promise.race([
                this.currentUpdate.downloadAndInstall((event) => {
                    switch (event.event) {
                        case 'Started':
                            contentLength = event.data.contentLength ?? 0;
                            console.log(`[UpdateService] Download started: ${contentLength} bytes`);
                            break;
                        case 'Progress':
                            downloaded += event.data.chunkLength;
                            if (onProgress && contentLength > 0) {
                                onProgress({
                                    downloaded,
                                    total: contentLength,
                                    percentage: Math.round((downloaded / contentLength) * 100),
                                });
                            }
                            break;
                        case 'Finished':
                            console.log('[UpdateService] Download finished');
                            break;
                    }
                }),
                timeoutPromise
            ]);

            console.log('[UpdateService] Update installed, restarting...');
            await relaunch();
        } catch (error) {
            console.error('[UpdateService] Failed to install update:', error);
            if (error instanceof Error) {
                if (error.message.includes('signature')) {
                    throw new Error('更新檔驗證失敗：簽名不符。這可能是因為您安裝了未簽名的版本，無法更新到官方簽名版。');
                }
                if (error.message.includes('timed out')) {
                    throw new Error('下載逾時，請檢查您的網路連線速度。');
                }
            }
            throw error;
        }
    }

    /**
     * Pick the platform-appropriate installer asset from a GitHub
     * release, stream it to the user's Downloads folder, and open it.
     * Used for beta/alpha channels where the Tauri updater plugin's
     * fixed endpoint can't be redirected at runtime.
     */
    private async downloadAndOpenChannelInstaller(
        release: GithubRelease,
        onProgress?: (progress: UpdateProgress) => void,
    ): Promise<void> {
        const isWindows = typeof navigator !== 'undefined' &&
            navigator.userAgent.includes('Windows');
        const buildVariant = await safeGetBuildVariant();

        let pickedAssetName: string | undefined;
        if (isWindows) {
            const suffix = buildVariant === 'cuda' ? '_cuda' : '';
            pickedAssetName = `ClassNoteAI_${stripTagPrefix(release.tag_name)}_x64${suffix}-setup.exe`;
        } else {
            pickedAssetName = `ClassNoteAI_${stripTagPrefix(release.tag_name)}_aarch64.dmg`;
        }

        const asset = release.assets.find((a) => a.name === pickedAssetName);
        if (!asset) {
            const names = release.assets.map((a) => a.name).join(', ');
            throw new Error(
                `在 release ${release.tag_name} 找不到對應的安裝檔 (${pickedAssetName})。可用的資產：${names || '(無)'}。`,
            );
        }

        console.log(`[UpdateService] Downloading ${asset.name} from ${asset.browser_download_url}`);
        await streamDownloadAndOpen(asset.browser_download_url, asset.name, onProgress);
    }

    /**
     * Get cached update info (from last check)
     */
    getCachedUpdate(): Update | null {
        return this.currentUpdate;
    }
    /**
     * Helper to manually download and open the DMG for macOS
     * This bypasses the strict signature checks of the updater plugin
     */
    async downloadAndOpenDmg(version: string, onProgress?: (percentage: number) => void): Promise<void> {
        try {
            console.log(`[UpdateService] Manual download requested for version v${version}`);

            // Construct DMG URL (assuming Apple Silicon for this user as verified)
            const filename = `ClassNoteAI_${version}_aarch64.dmg`;
            const url = `https://github.com/sklonely/ClassNoteAI/releases/download/v${version}/${filename}`;
            console.log(`[UpdateService] Downloading from: ${url}`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s connect timeout

            const response = await fetch(url, {
                method: 'GET',
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Failed to download DMG: ${response.statusText} (${response.status})`);
            }

            const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
            let downloaded = 0;

            // Prepare to write to Downloads folder
            const downloadDirPath = await downloadDir();
            const filePath = await join(downloadDirPath, filename);
            console.log(`[UpdateService] Saving to: ${filePath}`);

            // Streaming download for progress
            const reader = response.body?.getReader();
            if (!reader) throw new Error('Failed to initialize download stream');

            const chunks: Uint8Array[] = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                if (value) {
                    chunks.push(value);
                    downloaded += value.length;
                    if (onProgress && contentLength > 0) {
                        onProgress(Math.round((downloaded / contentLength) * 100));
                    }
                }
            }

            // Combine chunks
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const combined = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                combined.set(chunk, offset);
                offset += chunk.length;
            }

            // Write file
            await writeFile(filename, combined, { baseDir: BaseDirectory.Download });
            console.log('[UpdateService] Download complete, opening file...');

            // Open the specific file path
            // Note: plugin-opener's open() usually takes a path or URL. 
            // We need the absolute path.
            await openPath(filePath);

        } catch (error) {
            console.error('[UpdateService] Failed to manually download/open DMG:', error);
            throw error;
        }
    }
}

// ---- module-local helpers -------------------------------------------------

function stripTagPrefix(tag: string): string {
    return tag.startsWith('v') ? tag.slice(1) : tag;
}

/**
 * Minimal semver-ish compare that's good enough for our tags: splits
 * `MAJOR.MINOR.PATCH` (ignoring any prerelease suffix after `-`) and
 * compares numerically per field. Returns true iff `next` strictly
 * beats `current`.
 *
 * For same MAJOR.MINOR.PATCH but different prerelease tiers (e.g.
 * 0.6.0-alpha.1 vs 0.6.0-alpha.2), we compare the full tail as
 * strings — alpha.2 > alpha.1 lexicographically, which is fine until
 * two-digit counters (alpha.10) show up. That's acceptable until we
 * see cadence warrant it.
 */
function isVersionNewer(next: string, current: string): boolean {
    const [nextCore, nextTail = ''] = next.split('-', 2);
    const [currCore, currTail = ''] = current.split('-', 2);
    const a = nextCore.split('.').map((x) => parseInt(x, 10) || 0);
    const b = currCore.split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const ai = a[i] ?? 0;
        const bi = b[i] ?? 0;
        if (ai !== bi) return ai > bi;
    }
    // Same core. Stable (empty tail) > any prerelease tail.
    if (!nextTail && currTail) return true;
    if (nextTail && !currTail) return false;
    return nextTail > currTail;
}

async function safeGetBuildVariant(): Promise<string | null> {
    try {
        return await invoke<string>('get_build_variant');
    } catch {
        return null;
    }
}

async function streamDownloadAndOpen(
    url: string,
    filename: string,
    onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
        throw new Error(`Failed to download installer: ${response.statusText} (${response.status})`);
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    let downloaded = 0;

    const downloadDirPath = await downloadDir();
    const filePath = await join(downloadDirPath, filename);
    console.log(`[UpdateService] Saving to: ${filePath}`);

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Failed to initialize download stream');

    const chunks: Uint8Array[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
            chunks.push(value);
            downloaded += value.length;
            if (onProgress && contentLength > 0) {
                onProgress({
                    downloaded,
                    total: contentLength,
                    percentage: Math.round((downloaded / contentLength) * 100),
                });
            }
        }
    }

    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }

    await writeFile(filename, combined, { baseDir: BaseDirectory.Download });
    console.log('[UpdateService] Download complete, opening installer...');
    await openPath(filePath);
}

export const updateService = new UpdateService();
