import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    getAppSettingsMock,
    getSettingMock,
    saveSettingMock,
    isAvailableMock,
    recognizePagesMock,
    renderPagesMock,
    extractTextMock,
    extractAllPagesTextMock,
    hasEmbeddingsMock,
    getStatsMock,
    replaceEmbeddingsForLectureMock,
    chunkTextMock,
    chunkPdfByPagesMock,
    generateLocalEmbeddingMock,
    generateLocalEmbeddingsBatchMock,
    invalidateMock,
} = vi.hoisted(() => ({
    getAppSettingsMock: vi.fn(),
    getSettingMock: vi.fn(),
    saveSettingMock: vi.fn(),
    isAvailableMock: vi.fn(),
    recognizePagesMock: vi.fn(),
    renderPagesMock: vi.fn(),
    extractTextMock: vi.fn(),
    extractAllPagesTextMock: vi.fn(),
    hasEmbeddingsMock: vi.fn(),
    getStatsMock: vi.fn(),
    replaceEmbeddingsForLectureMock: vi.fn(),
    chunkTextMock: vi.fn(),
    chunkPdfByPagesMock: vi.fn(),
    generateLocalEmbeddingMock: vi.fn(),
    generateLocalEmbeddingsBatchMock: vi.fn(),
    invalidateMock: vi.fn(),
}));

vi.mock('../llm', () => ({
    chat: vi.fn(),
    chatStream: vi.fn(),
    translateForRetrieval: vi.fn(),
}));

vi.mock('../remoteOcrService', () => ({
    remoteOcrService: {
        isAvailable: isAvailableMock,
        recognizePages: recognizePagesMock,
    },
}));

vi.mock('../pdfToImageService', () => ({
    pdfToImageService: {
        renderPages: renderPagesMock,
        extractText: extractTextMock,
    },
}));

vi.mock('../pdfService', () => ({
    pdfService: {
        extractAllPagesText: extractAllPagesTextMock,
    },
}));

vi.mock('../storageService', () => ({
    storageService: {
        getAppSettings: getAppSettingsMock,
        getSetting: getSettingMock,
        saveSetting: saveSettingMock,
    },
}));

vi.mock('../embeddingStorageService', () => ({
    embeddingStorageService: {
        semanticSearch: vi.fn(),
        semanticSearchByCourse: vi.fn(),
        hasEmbeddings: hasEmbeddingsMock,
        getStats: getStatsMock,
        deleteByLecture: vi.fn(),
        storeEmbeddings: vi.fn(),
        getEmbeddingsByLecture: vi.fn(() => Promise.resolve([])),
        replaceEmbeddingsForLecture: replaceEmbeddingsForLectureMock,
        getChunksByPage: vi.fn(() => Promise.resolve([])),
    },
}));

vi.mock('../chunkingService', () => ({
    chunkingService: {
        chunkText: chunkTextMock,
        chunkPdfByPages: chunkPdfByPagesMock,
    },
}));

vi.mock('../embeddingService', () => ({
    generateLocalEmbedding: generateLocalEmbeddingMock,
    generateLocalEmbeddingsBatch: generateLocalEmbeddingsBatchMock,
}));

vi.mock('../bm25Service', () => ({
    bm25Service: {
        search: vi.fn(() => Promise.resolve([])),
        invalidate: invalidateMock,
    },
    reciprocalRankFusion: vi.fn(() => []),
}));

import { ragService } from '../ragService';

function makeChunk(text: string, lectureId: string, sourceType: 'pdf' | 'transcript') {
    return {
        id: `${lectureId}-${sourceType}-0`,
        text,
        lectureId,
        sourceType,
        position: 0,
    };
}

describe('ragService.indexLectureWithOCR routing', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        getAppSettingsMock.mockResolvedValue({ ocr: { mode: 'auto' } });
        getSettingMock.mockResolvedValue(null);
        saveSettingMock.mockResolvedValue(undefined);

        hasEmbeddingsMock.mockResolvedValue(false);
        getStatsMock.mockResolvedValue(null);
        replaceEmbeddingsForLectureMock.mockResolvedValue(undefined);

        isAvailableMock.mockResolvedValue(true);
        recognizePagesMock.mockResolvedValue([
            { pageNumber: 1, text: 'Remote OCR page text', success: true },
        ]);

        renderPagesMock.mockResolvedValue([
            { pageNumber: 1, imageBase64: 'data:image/png;base64,AAA' },
        ]);
        extractTextMock.mockResolvedValue('Fallback page text');
        extractAllPagesTextMock.mockResolvedValue([
            { page: 1, text: 'PDF.js page text' },
        ]);

        chunkTextMock.mockImplementation((text: string, lectureId: string, sourceType: 'pdf' | 'transcript') => [
            makeChunk(text, lectureId, sourceType),
        ]);
        chunkPdfByPagesMock.mockImplementation((pages: Array<{ pageNumber: number; text: string }>, lectureId: string) =>
            pages.map((page, index) => ({
                id: `${lectureId}-pdf-${index}`,
                text: page.text,
                lectureId,
                sourceType: 'pdf' as const,
                position: 0,
                pageNumber: page.pageNumber,
            })),
        );

        generateLocalEmbeddingMock.mockResolvedValue([0.1, 0.2, 0.3]);
        generateLocalEmbeddingsBatchMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
        invalidateMock.mockReturnValue(undefined);
    });

    it('uses remote OCR when a cloud vision provider is available', async () => {
        const result = await ragService.indexLectureWithOCR(
            'lecture-1',
            new Uint8Array([1, 2, 3]).buffer,
            null,
            undefined,
            true,
        );

        expect(result).toEqual({ chunksCount: 1, success: true });
        expect(isAvailableMock).toHaveBeenCalledTimes(1);
        expect(renderPagesMock).toHaveBeenCalledTimes(1);
        expect(recognizePagesMock).toHaveBeenCalledWith(
            [{ pageNumber: 1, imageBase64: 'data:image/png;base64,AAA' }],
            expect.any(Function),
        );
        expect(extractAllPagesTextMock).not.toHaveBeenCalled();
        expect(replaceEmbeddingsForLectureMock).toHaveBeenCalledWith(
            'lecture-1',
            [
                expect.objectContaining({
                    text: 'Remote OCR page text',
                    metadata: { pageNumber: 1 },
                }),
            ],
            [[0.1, 0.2, 0.3]],
        );
    });

    it('falls back to PDF.js page extraction when remote OCR is unavailable', async () => {
        isAvailableMock.mockResolvedValueOnce(false);
        const fallbackSpy = vi
            .spyOn(ragService, 'indexLectureFromPages')
            .mockResolvedValueOnce({ chunksCount: 1, success: true });

        const result = await ragService.indexLectureWithOCR(
            'lecture-1',
            new Uint8Array([4, 5, 6]).buffer,
            'Transcript text',
            undefined,
            true,
        );

        expect(result).toEqual({ chunksCount: 1, success: true });
        expect(isAvailableMock).toHaveBeenCalledTimes(1);
        expect(recognizePagesMock).not.toHaveBeenCalled();
        expect(renderPagesMock).not.toHaveBeenCalled();
        expect(extractAllPagesTextMock).toHaveBeenCalledTimes(1);
        expect(fallbackSpy).toHaveBeenCalledWith(
            'lecture-1',
            [{ pageNumber: 1, text: 'PDF.js page text' }],
            'Transcript text',
            undefined,
        );
        expect(saveSettingMock).toHaveBeenCalledTimes(1);

        fallbackSpy.mockRestore();
    });

    it('treats historical local OCR mode as off and never probes remote OCR', async () => {
        getAppSettingsMock.mockResolvedValueOnce({ ocr: { mode: 'local' } });
        const fallbackSpy = vi
            .spyOn(ragService, 'indexLectureFromPages')
            .mockResolvedValueOnce({ chunksCount: 1, success: true });

        const result = await ragService.indexLectureWithOCR(
            'lecture-legacy',
            new Uint8Array([7, 8, 9]).buffer,
            null,
            undefined,
            true,
        );

        expect(result).toEqual({ chunksCount: 1, success: true });
        expect(isAvailableMock).not.toHaveBeenCalled();
        expect(recognizePagesMock).not.toHaveBeenCalled();
        expect(renderPagesMock).not.toHaveBeenCalled();
        expect(extractAllPagesTextMock).toHaveBeenCalledTimes(1);
        expect(fallbackSpy).toHaveBeenCalledWith(
            'lecture-legacy',
            [{ pageNumber: 1, text: 'PDF.js page text' }],
            null,
            undefined,
        );

        fallbackSpy.mockRestore();
    });
});
