/**
 * Update Service
 * 
 * Handles application updates using Tauri's updater plugin.
 * Supports both automatic and manual update checks.
 */

import { check, Update, UpdateInfo } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { open } from '@tauri-apps/plugin-opener';
import { writeFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { fetch } from '@tauri-apps/plugin-http';
import { downloadDir, join } from '@tauri-apps/api/path';

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

    /**
     * Check for available updates
     */
    /**
     * Check for available updates
     */
    async checkForUpdates(): Promise<UpdateInfo> {
        // Prevent update check in development mode to avoid confusion
        if (import.meta.env.DEV) {
            console.log('[UpdateService] Running in development mode, updates disabled.');
            return { available: false };
        }

        try {
            console.log('[UpdateService] Checking for updates...');
            const update = await check();

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
            // Enhance error message for common issues
            if (error instanceof Error) {
                if (error.message.includes('Network')) {
                    throw new Error('無法連接到更新伺服器，請檢查網路連線。');
                }
            }
            throw error;
        }
    }

    /**
     * Download and install the update with progress callback
     */
    async downloadAndInstall(
        onProgress?: (progress: UpdateProgress) => void
    ): Promise<void> {
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
            await open(filePath);

        } catch (error) {
            console.error('[UpdateService] Failed to manually download/open DMG:', error);
            throw error;
        }
    }
}

export const updateService = new UpdateService();
