/**
 * Setup Types
 * 
 * TypeScript types for the first-run setup wizard.
 * Note: Rust enums with serde serialize as { "VariantName": data } or just "VariantName" for unit variants
 */

export type RequirementCategory = 'System' | 'Model' | 'Runtime';

// Rust serde serializes enums as either:
// - "Installed" for unit variants
// - { "Outdated": { current: "...", required: "..." } } for variants with data
export type RequirementStatus =
    | 'Installed'
    | 'NotInstalled'
    | { Outdated: { current: string; required: string } }
    | { Error: string };

export interface Requirement {
    id: string;
    name: string;
    description: string;
    category: RequirementCategory;
    status: RequirementStatus;
    is_optional: boolean;
    install_size_mb: number;
    install_source: string | null;
}

export interface SetupStatus {
    is_complete: boolean;
    requirements: Requirement[];
    total_download_size_mb: number;
    estimated_time_minutes: number;
}

export type ProgressStatus =
    | 'Pending'
    | 'InProgress'
    | 'Completed'
    | { Failed: string }
    | 'Cancelled';

export interface Progress {
    task_id: string;
    task_name: string;
    status: ProgressStatus;
    current: number;
    total: number;
    speed_bps: number | null;
    eta_seconds: number | null;
    message: string | null;
}

// Helper functions for type guards
export function isInstalled(status: RequirementStatus): boolean {
    return status === 'Installed';
}

export function isNotInstalled(status: RequirementStatus): boolean {
    return status === 'NotInstalled';
}

export function isOutdated(status: RequirementStatus): boolean {
    return typeof status === 'object' && 'Outdated' in status;
}

export function isError(status: RequirementStatus): boolean {
    return typeof status === 'object' && 'Error' in status;
}

export function getProgressPercentage(progress: Progress): number {
    if (progress.total === 0) return 0;
    return Math.round((progress.current / progress.total) * 100);
}

export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatTime(seconds: number): string {
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes} 分 ${secs} 秒`;
}

