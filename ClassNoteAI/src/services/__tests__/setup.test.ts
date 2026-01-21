/**
 * Sample test to verify Vitest setup
 */

import { describe, it, expect, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { setMockInvokeResult } from '../../test/setup';

describe('Test Setup Verification', () => {
    it('should have vi available globally', () => {
        expect(vi).toBeDefined();
    });

    it('should mock Tauri invoke', async () => {
        // Mock a specific command result
        setMockInvokeResult('get_setting', 'test_value');

        // Call the mocked invoke
        const result = await invoke('get_setting', { key: 'test' });

        expect(result).toBe('test_value');
        expect(invoke).toHaveBeenCalledWith('get_setting', { key: 'test' });
    });

    it('should return null for unmocked commands', async () => {
        const result = await invoke('unknown_command');
        expect(result).toBeNull();
    });

    it('should handle mock errors', async () => {
        setMockInvokeResult('failing_command', new Error('Test error'));

        await expect(invoke('failing_command')).rejects.toThrow('Test error');
    });
});
