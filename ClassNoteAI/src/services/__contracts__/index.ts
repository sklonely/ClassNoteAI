/**
 * Phase 7 service contracts — type-only barrel.
 *
 * Importers should prefer this barrel over deep paths so that contract
 * file renames stay invisible to call sites:
 *
 * ```ts
 * import type { RecordingSessionService, ActionId } from '@/services/__contracts__';
 * ```
 */

export * from './recordingSessionService.contract';
export * from './taskTrackerService.contract';
export * from './keymapService.contract';
