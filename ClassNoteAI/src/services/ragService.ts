/**
 * RAG (Retrieval-Augmented Generation) service.
 *
 * Embeddings: local Candle `BAAI/bge-small-en-v1.5` (shipped via the
 * embedding-model download flow in Settings). Switched from
 * nomic-embed-text-v1 in v0.5.2 — nomic uses NomicBert (rotary +
 * SwiGLU) which Candle's stock BertModel::load cannot decode. English
 * content + a translate-query step for Chinese user queries gives
 * better MTEB scores than a multilingual 384-d encoder could.
 * No network calls — everything runs on-device.
 *
 * OCR: optional Ollama `deepseek-ocr` for complex slide decks. If not
 * reachable, we pre-flight-skip and fall back to pdfjs text extraction.
 */

import { chunkingService, TextChunk } from './chunkingService';
import { embeddingStorageService, SearchResult } from './embeddingStorageService';
import { generateLocalEmbedding, generateLocalEmbeddingsBatch } from './embeddingService';
import { chat as llmChat, chatStream as llmChatStream, translateForRetrieval } from './llm';
import { computeContentHash, ocrService } from './ocrService';
import { remoteOcrService } from './remoteOcrService';
import { pdfToImageService } from './pdfToImageService';
// `pdfService` pulls in pdfjs-dist at module load, which needs the
// DOMMatrix browser API. Vitest's jsdom env doesn't polyfill that,
// so a static import here would break every test that touches
// ragService (ragService.crossLingual.test.ts etc.). We use a
// deferred dynamic import in the one path that actually needs
// per-page text extraction (the no-OCR fallback in
// `indexLectureWithOCR`). At runtime in the app bundle this is a
// no-op since Vite already pre-bundles pdfjs.
let _pdfServiceCache: typeof import('./pdfService')['pdfService'] | null = null;
async function getPdfService() {
    if (!_pdfServiceCache) {
        const mod = await import('./pdfService');
        _pdfServiceCache = mod.pdfService;
    }
    return _pdfServiceCache;
}
import { storageService } from './storageService';
import { bm25Service, reciprocalRankFusion } from './bm25Service';

/**
 * Returns true if the query contains any CJK Unified Ideograph, Hiragana,
 * Katakana, or Hangul. Used as a cheap trigger for the translate-query
 * cross-lingual path: if the user typed Chinese but the course content
 * is English, we route the query through LLM translation before
 * embedding to avoid the ~20-point MTEB retrieval gap you'd see from
 * a multilingual embedder. ASCII-only queries skip translation.
 */
function containsCJK(s: string): boolean {
    return /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(s);
}

export interface RAGContext {
    chunks: SearchResult[];
    formattedContext: string;
}

export interface IndexingProgress {
    stage: 'chunking' | 'embedding' | 'storing';
    current: number;
    total: number;
    message: string;
}

class RAGService {
    /**
     * 為課堂建立索引 (分塊 + 嵌入)
     */
    public async indexLecture(
        lectureId: string,
        pdfText: string | null,
        transcriptText: string | null,
        onProgress?: (progress: IndexingProgress) => void
    ): Promise<{ chunksCount: number; success: boolean }> {
        try {
            const allChunks: TextChunk[] = [];

            // 階段 1: 文本分塊
            onProgress?.({
                stage: 'chunking',
                current: 0,
                total: 2,
                message: '正在分割文本...',
            });

            if (pdfText && pdfText.trim().length > 0) {
                const pdfChunks = chunkingService.chunkText(pdfText, lectureId, 'pdf');
                allChunks.push(...pdfChunks);
                console.log(`[RAGService] PDF 分塊完成: ${pdfChunks.length} 個 chunks`);
            }

            onProgress?.({
                stage: 'chunking',
                current: 1,
                total: 2,
                message: '正在分割轉錄文本...',
            });

            if (transcriptText && transcriptText.trim().length > 0) {
                const transcriptChunks = chunkingService.chunkText(transcriptText, lectureId, 'transcript');
                allChunks.push(...transcriptChunks);
                console.log(`[RAGService] 轉錄分塊完成: ${transcriptChunks.length} 個 chunks`);
            }

            if (allChunks.length === 0) {
                console.log('[RAGService] 沒有可索引的內容');
                return { chunksCount: 0, success: true };
            }

            // 階段 2: 生成嵌入向量
            onProgress?.({
                stage: 'embedding',
                current: 0,
                total: allChunks.length,
                message: '正在生成嵌入向量...',
            });

            const texts = allChunks.map(c => c.text);
            // Batch-embed in groups of 16 chunks. Batch-size hand-picked:
            // small enough that the padded attention tensor stays within
            // CPU L2 (16 × 512 tokens × 768 hidden = 6 MB f32), large
            // enough to amortize the per-call overhead that was eating
            // 70% of wall time before batching (tokenizer lock acquire
            // + Tauri IPC serialize/deserialize × 100 chunks).
            // v0.6.0: 16 → 32. BGE-small-en-v1.5 is ~33M params; a
            // batch of 32 at seq_len 512 costs ~120 MB of activation
            // memory, well within a desktop's headroom. Cuts wall time
            // for a 70-min lecture's ~200 chunks from ~13 batches to
            // ~7, and the embedding model's per-call Tauri IPC overhead
            // halves accordingly.
            const BATCH = 32;
            const embeddings: number[][] = [];
            for (let i = 0; i < texts.length; i += BATCH) {
                const slice = texts.slice(i, i + BATCH);
                const vecs = await generateLocalEmbeddingsBatch(slice);
                embeddings.push(...vecs);
                onProgress?.({
                    stage: 'embedding',
                    current: Math.min(i + BATCH, texts.length),
                    total: texts.length,
                    message: `生成嵌入向量 (${Math.min(i + BATCH, texts.length)}/${texts.length})`,
                });
            }

            // 階段 3: 存儲到數據庫
            onProgress?.({
                stage: 'storing',
                current: 0,
                total: 1,
                message: '正在存儲索引...',
            });

            // Atomicity: a single Rust-side transaction that deletes the old
            // lecture embeddings AND inserts the new ones. Prior version did
            // a JS-side delete-then-store; a failure in storeEmbeddings left
            // the user with NO index at all (old deleted, new aborted) and
            // the bug surfaced as a silent zero-embedding state (hasEmbeddings
            // returned true from the new partial write, but retrieval was
            // incomplete). See audit note F-4 in docs/follow-ups.
            await embeddingStorageService.replaceEmbeddingsForLecture(lectureId, allChunks, embeddings);
            // Keep the BM25 side in sync — dense embeddings and BM25 index
            // must always describe the same chunk set for RRF fusion to
            // produce sensible results.
            bm25Service.invalidate(lectureId);

            onProgress?.({
                stage: 'storing',
                current: 1,
                total: 1,
                message: '索引完成',
            });

            console.log(`[RAGService] 課堂 ${lectureId} 索引完成: ${allChunks.length} 個 chunks`);
            return { chunksCount: allChunks.length, success: true };
        } catch (error) {
            console.error('[RAGService] 索引失敗:', error);
            return { chunksCount: 0, success: false };
        }
    }

    /**
     * Page-aware variant of indexLecture. Unlike the plain version
     * above which chunks a flat pdfText string (losing pageNumber),
     * this one chunks each page separately via chunkPdfByPages so
     * every resulting chunk carries its source page. Auto-Follow
     * alignment derives per-page embeddings by grouping on that
     * field, so without it the whole slide-following feature is
     * silently broken.
     */
    public async indexLectureFromPages(
        lectureId: string,
        pages: { pageNumber: number; text: string }[],
        transcriptText: string | null,
        onProgress?: (progress: IndexingProgress) => void
    ): Promise<{ chunksCount: number; success: boolean }> {
        try {
            const allChunks: TextChunk[] = [];

            onProgress?.({ stage: 'chunking', current: 0, total: 2, message: '正在分割 PDF 頁面...' });
            if (pages.length > 0) {
                const pdfChunks = chunkingService.chunkPdfByPages(pages, lectureId);
                allChunks.push(...pdfChunks);
                console.log(`[RAGService] PDF 分塊完成 (page-aware): ${pdfChunks.length} 個 chunks / ${pages.length} 頁`);
            }

            onProgress?.({ stage: 'chunking', current: 1, total: 2, message: '正在分割轉錄文本...' });
            if (transcriptText && transcriptText.trim().length > 0) {
                const transcriptChunks = chunkingService.chunkText(transcriptText, lectureId, 'transcript');
                allChunks.push(...transcriptChunks);
            }

            if (allChunks.length === 0) {
                return { chunksCount: 0, success: true };
            }

            onProgress?.({ stage: 'embedding', current: 0, total: allChunks.length, message: '正在生成嵌入向量...' });
            // v0.6.0: 16 → 32. BGE-small-en-v1.5 is ~33M params; a
            // batch of 32 at seq_len 512 costs ~120 MB of activation
            // memory, well within a desktop's headroom. Cuts wall time
            // for a 70-min lecture's ~200 chunks from ~13 batches to
            // ~7, and the embedding model's per-call Tauri IPC overhead
            // halves accordingly.
            const BATCH = 32;
            const texts = allChunks.map((c) => c.text);
            const embeddings: number[][] = [];
            for (let i = 0; i < texts.length; i += BATCH) {
                const slice = texts.slice(i, i + BATCH);
                const vecs = await generateLocalEmbeddingsBatch(slice);
                embeddings.push(...vecs);
                onProgress?.({
                    stage: 'embedding',
                    current: Math.min(i + BATCH, texts.length),
                    total: texts.length,
                    message: `生成嵌入向量 (${Math.min(i + BATCH, texts.length)}/${texts.length})`,
                });
            }

            onProgress?.({ stage: 'storing', current: 0, total: 1, message: '正在存儲索引...' });
            await embeddingStorageService.replaceEmbeddingsForLecture(lectureId, allChunks, embeddings);
            onProgress?.({ stage: 'storing', current: 1, total: 1, message: '索引完成' });

            console.log(`[RAGService] 課堂 ${lectureId} page-aware 索引完成: ${allChunks.length} chunks`);
            return { chunksCount: allChunks.length, success: true };
        } catch (error) {
            console.error('[RAGService] page-aware 索引失敗:', error);
            return { chunksCount: 0, success: false };
        }
    }

    /**
     * 使用 DeepSeek-OCR 為課堂 PDF 建立索引
     * 適合包含表格、數學公式的複雜 PDF
     * @param lectureId 課堂 ID
     * @param pdfData PDF 的 ArrayBuffer
     * @param transcriptText 轉錄文本 (可選)
     * @param onProgress 進度回調
     */
    public async indexLectureWithOCR(
        lectureId: string,
        pdfData: ArrayBuffer | null,
        transcriptText: string | null,
        onProgress?: (progress: IndexingProgress) => void,
        forceRefresh: boolean = false // 是否強制刷新 (忽略緩存)
    ): Promise<{ chunksCount: number; success: boolean }> {
        try {
            // v0.5.2 OCR decision tree. Settings → `ocr.mode` picks the
            // strategy; defaults to `auto` (remote preferred, local
            // fallback, pdfjs last resort). See src/types/index.ts for
            // the mode semantics. The picked backend implements the
            // same `recognizePages(pages, onProgress)` contract so the
            // downstream OCR loop below doesn't branch.
            type OcrRecognize = (
                pages: { pageNumber: number; imageBase64: string }[],
                onProgress?: (current: number, total: number) => void,
                _concurrency?: number,
                _lectureId?: string,
                _forceRefresh?: boolean,
            ) => Promise<Array<{ pageNumber: number; text: string; success: boolean; error?: string }>>;
            type OcrBackend = { name: 'remote' | 'local'; recognize: OcrRecognize } | null;

            const contentHashKey = `lecture_content_hash_${lectureId}`;
            const pdfHash = pdfData
                ? await computeContentHash(new Uint8Array(pdfData))
                : 'no-pdf';
            const contentHash = await computeContentHash(
                new TextEncoder().encode(
                    JSON.stringify({
                        pdfHash,
                        transcriptText: transcriptText ?? '',
                    }),
                ),
            );
            const persistContentHash = async () => {
                await storageService.saveSetting(contentHashKey, contentHash);
            };

            if (!forceRefresh) {
                const storedHash = await storageService.getSetting(contentHashKey);
                if (storedHash === contentHash) {
                    const hasExistingIndex = await embeddingStorageService.hasEmbeddings(lectureId);
                    if (hasExistingIndex) {
                        const stats = await embeddingStorageService.getStats(lectureId).catch(() => null);
                        console.log(`[RAGService] Skipping OCR re-index for lecture ${lectureId}; content hash unchanged.`);
                        return { chunksCount: stats?.total ?? 0, success: true };
                    }
                }
            }

            let backend: OcrBackend = null;

            if (pdfData) {
                const settings = await storageService.getAppSettings().catch(() => null);
                const mode = settings?.ocr?.mode ?? 'auto';

                if (mode !== 'off') {
                    const wantRemote = mode === 'auto' || mode === 'remote';
                    const wantLocal = mode === 'auto' || mode === 'local';

                    // Try remote first (cloud LLM vision). Fast availability
                    // check — doesn't do a real request, just probes
                    // `resolveActiveProvider` + listModels capabilities.
                    if (wantRemote) {
                        const remoteReady = await remoteOcrService.isAvailable();
                        if (remoteReady) {
                            backend = {
                                name: 'remote',
                                recognize: (pages, cb) =>
                                    remoteOcrService.recognizePages(pages, cb),
                            };
                        }
                    }
                    // Fall through to Ollama if allowed by mode.
                    if (!backend && wantLocal) {
                        const ollamaReady = await ocrService.isAvailable();
                        if (ollamaReady) {
                            backend = {
                                name: 'local',
                                recognize: (pages, cb, _conc, lecId, force) =>
                                    ocrService.recognizePages(pages, cb, 1, lecId, force),
                            };
                        }
                    }
                }

                if (!backend) {
                    // pdfjs-only fallback. Either OCR is off, or neither
                    // remote nor local backend is ready. No 32×60s
                    // wait-for-timeout like the pre-v0.5.2 code -- we
                    // bailed fast on the availability probes.
                    const reason = mode === 'off'
                        ? '已停用 OCR，改用 PDF 文字提取'
                        : '未偵測到可用 OCR，改用 PDF 文字提取';
                    console.warn(`[RAGService] ${reason}`);
                    onProgress?.({
                        stage: 'chunking',
                        current: 0,
                        total: 1,
                        message: reason,
                    });
                    // Per-page extraction instead of one flat string so
                    // chunks keep pageNumber metadata. Auto-Follow later
                    // derives page-level embeddings by grouping on that
                    // field -- without it, the PDF index is unusable for
                    // slide alignment.
                    const pdfSvc = await getPdfService();
                    const pagesText = await pdfSvc.extractAllPagesText(pdfData.slice(0));
                    const indexResult = await this.indexLectureFromPages(
                        lectureId,
                        pagesText.filter((p) => p.text.trim().length > 0).map((p) => ({ pageNumber: p.page, text: p.text })),
                        transcriptText,
                        onProgress,
                    );
                    if (indexResult.success) {
                        await persistContentHash();
                    }
                    return indexResult;
                }
                console.log(`[RAGService] Using OCR backend: ${backend.name}`);
            }

            const allChunks: TextChunk[] = [];

            // 階段 1: OCR 識別 PDF 頁面
            if (pdfData) {
                onProgress?.({
                    stage: 'chunking',
                    current: 0,
                    total: 1,
                    message: '正在將 PDF 轉換為圖片...',
                });

                // 複製 pdfData 避免 buffer detached 問題
                const pdfDataCopy = pdfData.slice(0);

                // 將 PDF 轉換為圖片 (使用 scale 3.0 獲得高解析度，約 216 DPI)
                const pageImages = await pdfToImageService.renderPages(
                    pdfDataCopy,
                    undefined,
                    3.0, // Scale 3.0 for better OCR accuracy
                    (current, total) => {
                        onProgress?.({
                            stage: 'chunking',
                            current,
                            total: total * 2, // PDF 轉圖片 + OCR 兩階段
                            message: `渲染頁面 ${current}/${total}...`,
                        });
                    }
                );

                // OCR 識別 — dispatch via whichever backend was picked
                // in the decision tree above (remote LLM vision vs local
                // Ollama). Progress label mentions the backend so users
                // can tell which path they're on.
                if (!backend) {
                    // Defensive: decision tree should have populated
                    // `backend` or returned before this point. If not,
                    // fall back to pdfjs silently.
                    throw new Error('OCR backend not selected');
                }
                const backendLabel = backend.name === 'remote' ? '雲端' : '本機';
                const ocrResults = await backend.recognize(
                    pageImages,
                    (current, total) => {
                        onProgress?.({
                            stage: 'chunking',
                            current: pageImages.length + current,
                            total: pageImages.length + total,
                            message: `OCR 識別頁面 ${current}/${total}（${backendLabel}）...`,
                        });
                    },
                    1,
                    lectureId,
                    forceRefresh,
                );

                // 分塊處理 OCR 結果
                for (const result of ocrResults) {
                    let pageText = result.text;

                    // 如果 OCR 失敗，嘗試使用 PDF.js 提取文本 (Fallback)
                    if (!result.success || !pageText) {
                        console.warn(`[RAGService] 頁面 ${result.pageNumber} OCR 失敗，嘗試使用 PDF.js 提取文本...`);
                        try {
                            // 再次複製 pdfData 以避免 detached
                            const pdfDataForFallback = pdfData.slice(0);
                            pageText = await pdfToImageService.extractText(pdfDataForFallback, result.pageNumber);
                            console.log(`[RAGService] 頁面 ${result.pageNumber} PDF.js 提取成功 (${pageText.length} 字)`);
                        } catch (fallbackError) {
                            console.error(`[RAGService] 頁面 ${result.pageNumber} PDF.js 提取失敗:`, fallbackError);
                            continue; // 如果都失敗，跳過此頁
                        }
                    }

                    if (pageText && pageText.length > 0) {
                        const chunks = chunkingService.chunkText(pageText, lectureId, 'pdf');
                        // 為每個 chunk 添加頁碼元數據
                        chunks.forEach(chunk => {
                            chunk.metadata = {
                                ...chunk.metadata,
                                pageNumber: result.pageNumber
                            };
                        });
                        allChunks.push(...chunks);
                    }
                }

                console.log(`[RAGService] OCR PDF 分塊完成: ${allChunks.length} 個 chunks (${pageImages.length} 頁)`);
            }

            // 階段 2: 處理轉錄文本 (與原邏輯相同)
            if (transcriptText && transcriptText.trim().length > 0) {
                onProgress?.({
                    stage: 'chunking',
                    current: 1,
                    total: 2,
                    message: '正在分割轉錄文本...',
                });

                const transcriptChunks = chunkingService.chunkText(transcriptText, lectureId, 'transcript');
                allChunks.push(...transcriptChunks);
                console.log(`[RAGService] 轉錄分塊完成: ${transcriptChunks.length} 個 chunks`);
            }

            if (allChunks.length === 0) {
                console.warn('[RAGService] 沒有內容可索引');
                return { chunksCount: 0, success: false };
            }

            // 階段 3: 生成嵌入向量
            const embeddings: number[][] = [];

            for (let i = 0; i < allChunks.length; i++) {
                onProgress?.({
                    stage: 'embedding',
                    current: i + 1,
                    total: allChunks.length,
                    message: `生成嵌入向量 ${i + 1}/${allChunks.length}...`,
                });

                const embedding = await generateLocalEmbedding(allChunks[i].text);
                embeddings.push(embedding);
            }

            // 階段 4: 存儲 — atomic replace so a crash here doesn't leave
            // the lecture with zero embeddings (the delete-then-store bug
            // from the audit). Either the new index lands or the old
            // index stays intact.
            await embeddingStorageService.replaceEmbeddingsForLecture(lectureId, allChunks, embeddings);
            // Keep the BM25 side in sync — dense embeddings and BM25 index
            // must always describe the same chunk set for RRF fusion to
            // produce sensible results.
            bm25Service.invalidate(lectureId);
            await persistContentHash();

            onProgress?.({
                stage: 'storing',
                current: 1,
                total: 1,
                message: 'OCR 索引完成',
            });

            console.log(`[RAGService] 課堂 ${lectureId} OCR 索引完成: ${allChunks.length} 個 chunks`);
            return { chunksCount: allChunks.length, success: true };
        } catch (error) {
            console.error('[RAGService] OCR 索引失敗:', error);
            return { chunksCount: 0, success: false };
        }
    }

    /**
     * 語義檢索增強
     * @param currentPage 當前頁面，用於優先返回該頁面/相鄰頁面的內容
     */
    public async retrieveContext(
        query: string,
        lectureId: string,
        topK: number = 5,
        currentPage?: number
    ): Promise<RAGContext> {
        // v0.5.2: hybrid retrieval — dense (embedding cosine) + sparse
        // (BM25 via minisearch) fan-out, merged with Reciprocal Rank
        // Fusion (Cormack et al. 2009, k=60). The two methods surface
        // different kinds of relevance: dense captures paraphrase /
        // semantic overlap, BM25 captures exact keyword matches
        // (important for specific terms like "GDPR Article 17" or
        // "Fitts's Law" where an embedder's "near enough" ranking
        // can bury the one passage that actually mentions the term).
        //
        // We pull topK * 4 from each method so RRF has enough signal
        // to separate top-K worthy candidates from fringe matches.
        // A chunk that appears in both lists ranks highest; chunks in
        // one list still appear but weighted lower (RRF's natural
        // degradation for missing-from-one signal).
        //
        // v0.5.3: fixed the semanticSearch argument order --
        // `(lectureId, query, ...)`, not `(query, lectureId, ...)`.
        // The old wrong order embedded the UUID as the query and
        // searched for a lecture whose id equalled the user's
        // question, returning zero chunks on every call.
        const FANOUT = topK * 4;
        const [denseResults, bm25Results] = await Promise.all([
            embeddingStorageService.semanticSearch(lectureId, query, FANOUT, currentPage),
            bm25Service.search(lectureId, query, FANOUT),
        ]);

        const denseIds = denseResults.map((r) => r.chunk.id);
        const bm25Ids = bm25Results.map((r) => r.chunkId);
        const fused = reciprocalRankFusion([denseIds, bm25Ids]);

        // Map the fused ranking back to SearchResult objects. Prefer
        // the dense-side `similarity` if available (so the relevance-
        // threshold filter downstream still has a meaningful score)
        // and fall back to the fused RRF score when the chunk was
        // surfaced by BM25-only.
        const denseById = new Map(denseResults.map((r) => [r.chunk.id, r]));
        const bm25ById = new Map(bm25Results.map((r) => [r.chunkId, r]));
        const existingById = await embeddingStorageService.getEmbeddingsByLecture(lectureId);
        const existingMap = new Map(existingById.map((c) => [c.id, c]));
        let results: SearchResult[] = fused
            .slice(0, topK)
            .map(({ chunkId, score }) => {
                const d = denseById.get(chunkId);
                if (d) return d; // preserve dense similarity so threshold filter still works
                const base = existingMap.get(chunkId);
                if (!base) return null;
                // BM25-only hit — synthesise a search-result shape with
                // the RRF score promoted to `similarity` so downstream
                // code that compares against the 0.55 relevance floor
                // still works. In practice RRF @ rank 1 is ~0.0164, far
                // below any embedding-similarity threshold, so this
                // effectively trusts the keyword match to surface
                // without also asserting semantic confidence it doesn't
                // have.
                void score;
                void bm25ById;
                return { chunk: base, similarity: 0.6 };
            })
            .filter((x): x is SearchResult => x !== null);

        // 2. 如果有當前頁碼，強制獲取該頁內容並置頂
        if (currentPage) {
            const currentPageChunks = await embeddingStorageService.getChunksByPage(lectureId, currentPage);

            if (currentPageChunks.length > 0) {
                // 將 EmbeddingRecord 轉換為 SearchResult (相似度設為 1.0)
                const currentPageResults: SearchResult[] = currentPageChunks.map(chunk => ({
                    chunk,
                    similarity: 1.0
                }));

                // 過濾掉語義檢索中已存在的當前頁 chunks (避免重複)
                results = results.filter(r => r.chunk.pageNumber !== currentPage);

                // 將當前頁內容放在最前面
                results = [...currentPageResults, ...results];
            }
        }

        // 格式化上下文
        const formattedContext = this.formatContext(results);

        return {
            chunks: results,
            formattedContext,
        };
    }

    /**
     * 跨課堂語義檢索 (課程級別)
     */
    public async retrieveCourseContext(
        query: string,
        courseId: string,
        topK: number = 5
    ): Promise<RAGContext> {
        const results = await embeddingStorageService.semanticSearchByCourse(query, courseId, topK);
        const formattedContext = this.formatContext(results);

        return {
            chunks: results,
            formattedContext,
        };
    }

    /**
     * Minimum cosine similarity to consider a retrieved chunk actually
     * relevant to the query. Below this we drop the chunk. bge-small-en
     * -v1.5 produces scores in the ~0.3-0.9 range for related content
     * in practice; queries with no semantic overlap at all (pure
     * greetings, off-topic chit-chat, single-word inputs that happen to
     * match the course title) hover near 0.4-0.5, where the model is
     * clearly stretching to find "closest" chunks that aren't really
     * relevant. 0.55 lands a usable separation between "this query is
     * about the course" and "this query has nothing to do with it".
     */
    private static readonly RELEVANCE_THRESHOLD = 0.55;

    /**
     * RAG 增強問答
     * @param chatHistory 對話歷史 (可選，用於延續對話)
     */
    public async chat(
        question: string,
        lectureId: string,
        options?: {
            topK?: number;
            systemPrompt?: string;
            currentPage?: number; // 當前頁面，用於優先檢索
            chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>; // 對話歷史
        }
    ): Promise<{ answer: string; sources: SearchResult[] }> {
        const topK = options?.topK || 5;
        const basePrompt = options?.systemPrompt || '你是一個專業的課程助教，請用繁體中文回答。';

        // Cross-lingual retrieval. Course content is routinely mixed:
        // PDF slides in English, translated transcript chunks in
        // Chinese. Running only one query form misses half the corpus:
        //   - English-only query "what is this class about" matches
        //     English PDFs (sim ~0.52) but not Chinese transcripts.
        //   - Chinese-only query "這堂課在幹嘛" matches Chinese
        //     transcripts (sim ~0.60) but misses English PDFs.
        // So for CJK questions we run BOTH the original and the
        // English-translated form in parallel, then union by chunk id
        // keeping the higher similarity. The answering LLM still only
        // sees the user's original question so the reply language
        // matches what they typed.
        let context: RAGContext;
        if (containsCJK(question)) {
            const translatedQuery = await translateForRetrieval(question, 'en');
            console.log(
                `[RAGService] cross-lingual retrieval with both forms: ` +
                    `"${question}" + "${translatedQuery}"`,
            );
            const [ctxOrig, ctxTrans] = await Promise.all([
                this.retrieveContext(question, lectureId, topK, options?.currentPage),
                this.retrieveContext(translatedQuery, lectureId, topK, options?.currentPage),
            ]);
            const byId = new Map<string, SearchResult>();
            for (const r of [...ctxOrig.chunks, ...ctxTrans.chunks]) {
                const prev = byId.get(r.chunk.id);
                if (!prev || r.similarity > prev.similarity) byId.set(r.chunk.id, r);
            }
            const merged = Array.from(byId.values())
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, topK);
            context = { chunks: merged, formattedContext: this.formatContext(merged) };
        } else {
            context = await this.retrieveContext(question, lectureId, topK, options?.currentPage);
        }

        // Only enhance the prompt with retrieved context when at least one
        // chunk passes the relevance threshold. If the user typed a plain
        // greeting ("HI", "你好", "?"), semantic search will return top-K
        // chunks but their similarity scores will all be low — injecting
        // them anyway turns a greeting into a forced essay because the
        // enhanced prompt tells the LLM to use the context. Filtering here
        // is the structural fix; prior prompt-engineering workarounds
        // (telling the LLM "if greeting, reply short") were band-aids
        // that don't generalize to off-topic / ambiguous inputs.
        const relevantChunks = context.chunks.filter(
            (c) => c.similarity >= RAGService.RELEVANCE_THRESHOLD,
        );
        const useContext = relevantChunks.length > 0;
        const enhancedSystemPrompt = useContext
            ? this.buildEnhancedPrompt(
                basePrompt,
                this.formatContext(relevantChunks),
                options?.currentPage,
            )
            : basePrompt;
        if (!useContext && context.chunks.length > 0) {
            console.log(
                `[RAGService] Dropping ${context.chunks.length} retrieved chunks — top similarity ` +
                    `${context.chunks[0]?.similarity?.toFixed(3)} < threshold ` +
                    `${RAGService.RELEVANCE_THRESHOLD}. Falling back to plain chat for off-topic query.`,
            );
        }

        // 組合消息：歷史 + 當前問題
        const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

        if (options?.chatHistory && options.chatHistory.length > 0) {
            messages.push(...options.chatHistory);
        }
        messages.push({ role: 'user', content: question });

        // Route through the user's configured LLM provider
        const answer = await llmChat([
            { role: 'system', content: enhancedSystemPrompt },
            ...messages,
        ]);

        return {
            answer,
            // Return only the chunks we actually showed the LLM so the
            // UI's "來源" badges match the reply's grounding.
            sources: useContext ? relevantChunks : [],
        };
    }

    /**
     * Streaming counterpart of `chat()`. Same retrieval + prompt-assembly
     * logic; emits a single `sources` event up-front so the UI can render
     * the grounding badges immediately, then pipes token deltas.
     *
     * Yielding retrieval metadata before the first token lets the chat
     * panel append an empty assistant message with its source list
     * locked in, then append deltas into that same message as they
     * arrive. The old non-streaming path blocks for 5-10 seconds on
     * typical prompts; streaming makes the app feel alive.
     */
    public async *chatStream(
        question: string,
        lectureId: string,
        options?: {
            topK?: number;
            systemPrompt?: string;
            currentPage?: number;
            chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
        }
    ): AsyncGenerator<
        | { type: 'sources'; sources: SearchResult[] }
        | { type: 'delta'; delta: string }
        | { type: 'done' },
        void,
        void
    > {
        const topK = options?.topK || 5;
        const basePrompt = options?.systemPrompt || '你是一個專業的課程助教，請用繁體中文回答。';

        let context: RAGContext;
        if (containsCJK(question)) {
            const translatedQuery = await translateForRetrieval(question, 'en');
            console.log(
                `[RAGService] cross-lingual retrieval with both forms: ` +
                    `"${question}" + "${translatedQuery}"`,
            );
            const [ctxOrig, ctxTrans] = await Promise.all([
                this.retrieveContext(question, lectureId, topK, options?.currentPage),
                this.retrieveContext(translatedQuery, lectureId, topK, options?.currentPage),
            ]);
            const byId = new Map<string, SearchResult>();
            for (const r of [...ctxOrig.chunks, ...ctxTrans.chunks]) {
                const prev = byId.get(r.chunk.id);
                if (!prev || r.similarity > prev.similarity) byId.set(r.chunk.id, r);
            }
            const merged = Array.from(byId.values())
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, topK);
            context = { chunks: merged, formattedContext: this.formatContext(merged) };
        } else {
            context = await this.retrieveContext(question, lectureId, topK, options?.currentPage);
        }

        const relevantChunks = context.chunks.filter(
            (c) => c.similarity >= RAGService.RELEVANCE_THRESHOLD,
        );
        const useContext = relevantChunks.length > 0;
        const enhancedSystemPrompt = useContext
            ? this.buildEnhancedPrompt(
                basePrompt,
                this.formatContext(relevantChunks),
                options?.currentPage,
            )
            : basePrompt;

        yield { type: 'sources', sources: useContext ? relevantChunks : [] };

        const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
        if (options?.chatHistory && options.chatHistory.length > 0) {
            messages.push(...options.chatHistory);
        }
        messages.push({ role: 'user', content: question });

        for await (const delta of llmChatStream([
            { role: 'system', content: enhancedSystemPrompt },
            ...messages,
        ])) {
            if (delta) yield { type: 'delta', delta };
        }
        yield { type: 'done' };
    }

    /**
     * 格式化檢索到的上下文
     */
    private formatContext(results: SearchResult[]): string {
        if (results.length === 0) return '';

        const sections = results.map((result, index) => {
            const source = result.chunk.sourceType === 'pdf'
                ? `講義${result.chunk.pageNumber ? ` (第${result.chunk.pageNumber}頁)` : ''}`
                : '課堂錄音';

            return `[來源 ${index + 1}: ${source}]\n${result.chunk.chunkText}`;
        });

        return sections.join('\n\n');
    }

    /**
     * 構建增強的系統提示
     * @param currentPage 用戶當前閱讀的頁面
     */
    private buildEnhancedPrompt(basePrompt: string, context: string, currentPage?: number): string {
        const locationInfo = currentPage
            ? `\n用戶目前正在閱讀第 ${currentPage} 頁。\n`
            : '';

        return `${basePrompt}

以下是與用戶問題相關的課程內容，請基於這些內容回答問題：
${locationInfo}
${context}

請注意：
1. 優先使用上述內容回答問題
2. 如果內容不足以回答，請說明
3. 回答時請務必標註來源頁碼，格式為 [[頁碼:X]] (例如 [[頁碼:5]])，這將在界面上生成可點擊的跳轉鏈接。
4. 如果引用了多個頁面，請分別標註，例如 [[頁碼:5]] [[頁碼:8]]。`;
    }

    /**
     * 檢查課堂是否已建立索引
     */
    public async hasIndex(lectureId: string): Promise<boolean> {
        return embeddingStorageService.hasEmbeddings(lectureId);
    }

    /**
     * 獲取索引統計
     */
    public async getIndexStats(lectureId: string): Promise<{ total: number; pdf: number; transcript: number }> {
        return embeddingStorageService.getStats(lectureId);
    }

    /**
     * 刪除課堂索引
     */
    public async deleteIndex(lectureId: string): Promise<void> {
        await embeddingStorageService.deleteByLecture(lectureId);
        bm25Service.invalidate(lectureId);
    }
}

export const ragService = new RAGService();
