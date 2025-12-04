/**
 * Setup Service
 * 
 * Frontend service for interacting with the Rust setup module.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { SetupStatus, Progress, Requirement, isInstalled } from '../types/setup';

export const setupService = {
    /**
     * Check the current setup status
     */
    async checkStatus(): Promise<SetupStatus> {
        return invoke<SetupStatus>('check_setup_status');
    },

    /**
     * Check if setup is complete
     */
    async isComplete(): Promise<boolean> {
        return invoke<boolean>('is_setup_complete');
    },

    /**
     * Start installation of specified requirements
     */
    async startInstallation(requirementIds: string[]): Promise<void> {
        return invoke('start_setup_installation', { requirementIds });
    },

    /**
     * Cancel the current installation
     */
    async cancelInstallation(): Promise<void> {
        return invoke('cancel_setup_installation');
    },

    /**
     * Mark setup as complete
     */
    async markComplete(): Promise<void> {
        return invoke('mark_setup_complete');
    },

    /**
     * Reset setup status (for debugging)
     */
    async resetStatus(): Promise<void> {
        return invoke('reset_setup_status');
    },

    /**
     * Listen for progress updates
     */
    onProgress(callback: (progress: Progress) => void): Promise<UnlistenFn> {
        return listen<Progress>('setup-progress', (event) => {
            callback(event.payload);
        });
    },

    /**
     * Get list of missing requirements (not installed and not optional)
     */
    getMissingRequirements(status: SetupStatus): Requirement[] {
        return status.requirements.filter(
            r => !r.is_optional && !isInstalled(r.status)
        );
    },

    /**
     * Get list of optional missing requirements
     */
    getOptionalMissing(status: SetupStatus): Requirement[] {
        return status.requirements.filter(
            r => r.is_optional && !isInstalled(r.status)
        );
    },

    /**
     * Get list of all missing requirement IDs
     */
    getAllMissingIds(status: SetupStatus, includeOptional: boolean = false): string[] {
        return status.requirements
            .filter(r => {
                const isMissing = !isInstalled(r.status);
                return isMissing && (includeOptional || !r.is_optional);
            })
            .map(r => r.id);
    }
};

