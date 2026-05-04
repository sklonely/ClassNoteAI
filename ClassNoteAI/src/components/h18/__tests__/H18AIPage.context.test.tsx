/**
 * cp75.30 — H18AIPage forwards aiContext prop to useAIHistory.send.
 *
 * Bug it pins: prior to cp75.30, `<H18AIPage>` accepted aiContext but
 * the parent `<H18DeepApp>` never passed it. Even with the prop wired,
 * the page must call `send(text, aiContext)` so the lecture-scoped
 * lookup actually fires inside useAIHistory.
 *
 * We mock useAIHistory entirely — this is a focused props/wiring test;
 * the actual RAG + fallback path is covered in useAIHistory.fallback.test.ts.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AIContext } from '../useAIHistory';

const sendMock = vi.fn();

vi.mock('../useAIHistory', () => ({
    useAIHistory: () => ({
        msgs: [],
        streaming: false,
        send: sendMock,
        clear: vi.fn(),
    }),
}));

// storageService.listLectures is called on mount for the badge.
vi.mock('../../../services/storageService', () => ({
    storageService: {
        listLectures: vi.fn(async () => []),
    },
}));

// keymapService — H18AIPage reads display label for the dock keybinding.
vi.mock('../../../services/keymapService', () => ({
    keymapService: {
        getDisplayLabel: vi.fn(() => '⌘J'),
    },
}));

vi.mock('../../../services/__contracts__/keymapService.contract', () => ({
    SHORTCUTS_CHANGE_EVENT: 'shortcuts-change',
}));

import H18AIPage from '../H18AIPage';

describe('H18AIPage · cp75.30 aiContext propagation', () => {
    beforeEach(() => {
        sendMock.mockReset();
    });

    it('forwards aiContext to useAIHistory.send when user sends a message', () => {
        const ctx: AIContext = {
            kind: 'lecture',
            lectureId: 'L1',
            courseId: 'C1',
            label: 'ML',
        };
        render(<H18AIPage aiContext={ctx} onBack={() => {}} />);

        const input = screen.getByPlaceholderText('問 AI 任何問題…') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'hello' } });
        const sendBtn = screen.getByRole('button', { name: '送出' });
        fireEvent.click(sendBtn);

        expect(sendMock).toHaveBeenCalledTimes(1);
        expect(sendMock).toHaveBeenCalledWith('hello', ctx);
    });

    it('passes undefined ctx to send when aiContext prop is omitted (global mode)', () => {
        render(<H18AIPage onBack={() => {}} />);

        const input = screen.getByPlaceholderText('問 AI 任何問題…') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'hi' } });
        fireEvent.click(screen.getByRole('button', { name: '送出' }));

        expect(sendMock).toHaveBeenCalledTimes(1);
        expect(sendMock).toHaveBeenCalledWith('hi', undefined);
    });
});
