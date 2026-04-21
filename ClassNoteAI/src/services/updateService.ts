/**
 * Update Service
 * 
 * Handles application updates using Tauri's updater plugin.
 * Supports both automatic and manual update checks.
 */

import { openPath } from '@tauri-apps/plugin-opener';
import { writeFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { fetch } from '@tauri-apps/plugin-http';
import { downloadDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { storageService } from './storageService';

export type ReleaseChannel = 'stable' | 'beta' | 'alpha';

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
    private pendingChannel: string | null = null;

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
     */
    async checkForUpdates(): Promise<UpdateInfo> {
        if (import.meta.env.DEV) {
            console.log('[UpdateService] Running in development mode, updates disabled.');
            return { available: false };
        }

        const channel = await this.getReleaseChannel();
        try {
            await pickUpdaterTarget();
            const result = await invoke('check_update_for_channel', { channel });
            this.pendingChannel = channel;
            return result as UpdateInfo;
        } catch (error) {
            console.error('[UpdateService] Failed to check for updates:', error);
            if (error instanceof Error) {
                if (error.message.toLowerCase().includes('network')) {
                    throw new Error('無法連接到更新伺服器，請檢查網路連線。');
                }
            }
            throw error;
        }
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
        const channel = this.pendingChannel ?? await this.getReleaseChannel();

        if (!onProgress) {
            await invoke('download_and_install_update', { channel });
            return;
        }

        const progressCallback = onProgress;
        let downloaded = 0;
        const unlisten = await listen<{
            chunkLength: number;
            contentLength: number | null;
        }>('update-progress', (event) => {
            downloaded += event.payload.chunkLength;
            const total = event.payload.contentLength ?? 0;
            if (total > 0) {
                progressCallback({
                    downloaded,
                    total,
                    percentage: Math.round((downloaded / total) * 100),
                });
            }
        });

        try {
            await invoke('download_and_install_update', { channel });
        } finally {
            unlisten();
        }
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

export const updateService = new UpdateService();
