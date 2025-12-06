/**
 * Update Service
 * 
 * Handles application updates using Tauri's updater plugin.
 * Supports both automatic and manual update checks.
 */

import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

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
    async checkForUpdates(): Promise<UpdateInfo> {
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

            await this.currentUpdate.downloadAndInstall((event) => {
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
            });

            console.log('[UpdateService] Update installed, restarting...');
            await relaunch();
        } catch (error) {
            console.error('[UpdateService] Failed to install update:', error);
            throw error;
        }
    }

    /**
     * Get cached update info (from last check)
     */
    getCachedUpdate(): Update | null {
        return this.currentUpdate;
    }
}

export const updateService = new UpdateService();
