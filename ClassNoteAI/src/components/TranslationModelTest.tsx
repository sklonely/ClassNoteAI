/**
 * 翻譯模型測試組件
 * 用於測試 ONNX 翻譯模型的加載和基本功能
 */

import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { testTranslation, compareWithPython } from '../utils/testTranslation';
import { runFullVerification } from '../utils/verifyTranslationFix';

export function TranslationModelTest() {
  const [modelDir, setModelDir] = useState<string>('');
  const [tokenizerPath, setTokenizerPath] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [testText, setTestText] = useState<string>('Hello, how are you?');
  const [translationResult, setTranslationResult] = useState<string>('');

  const handleSelectModelDir = async () => {
    try {
      const selected = await open({
        directory: true,
        title: '選擇模型目錄（包含 encoder_model.onnx 和 decoder_model.onnx）',
      });
      if (selected) {
        setModelDir(selected as string);
      }
    } catch (error) {
      console.error('選擇目錄失敗:', error);
      setMessage(`選擇目錄失敗: ${error}`);
    }
  };

  const handleSelectTokenizer = async () => {
    try {
      const selected = await open({
        filters: [
          { name: 'JSON', extensions: ['json'] },
          { name: 'All', extensions: ['*'] },
        ],
        title: '選擇 Tokenizer 文件（tokenizer.json 或 vocab.json）',
      });
      if (selected) {
        setTokenizerPath(selected as string);
      }
    } catch (error) {
      console.error('選擇文件失敗:', error);
      setMessage(`選擇文件失敗: ${error}`);
    }
  };

  const handleLoadModel = async () => {
    if (!modelDir) {
      setMessage('請先選擇模型目錄');
      return;
    }

    setLoading(true);
    setMessage('');
    setTranslationResult('');

    try {
      const result = await invoke<string>('load_translation_model', {
        modelDir,
        tokenizerPath: tokenizerPath || null,
      });
      setMessage(`✅ ${result}`);
    } catch (error) {
      console.error('加載模型失敗:', error);
      setMessage(`❌ 加載失敗: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTestTranslation = async () => {
    if (!testText.trim()) {
      setMessage('請輸入測試文本');
      return;
    }

    setLoading(true);
    setMessage('');
    setTranslationResult('');

    try {
      console.log('[TranslationTest] 開始翻譯:', testText);
      const result = await invoke<{ translated_text: string; source: string; confidence?: number }>('translate_rough', {
        text: testText,
        sourceLang: 'en',
        targetLang: 'zh',
      });
      console.log('[TranslationTest] 翻譯結果 (完整對象):', JSON.stringify(result, null, 2));
      console.log('[TranslationTest] translated_text:', result.translated_text);
      console.log('[TranslationTest] translated_text 類型:', typeof result.translated_text);
      console.log('[TranslationTest] translated_text 長度:', result.translated_text?.length);
      console.log('[TranslationTest] source:', result.source);
      console.log('[TranslationTest] confidence:', result.confidence);
      
      // 處理 translated_text（可能是空字符串或 undefined）
      let translatedText = result?.translated_text || '';
      
      // 清理 SentencePiece 的空格標記（如果後端沒有處理）
      if (translatedText.includes('▁')) {
        console.log('[TranslationTest] 檢測到 SentencePiece 空格標記，進行清理');
        translatedText = translatedText.replace(/▁/g, ' ').trim();
      }
      
      console.log('[TranslationTest] 處理後的 translated_text:', translatedText);
      
      if (translatedText && translatedText.trim().length > 0) {
        setTranslationResult(translatedText);
        const sourceStr = result.source === 'Rough' || result.source === 'rough' ? '本地' : '遠程';
        setMessage(`✅ 翻譯成功 (來源: ${sourceStr}, 置信度: ${result.confidence || 'N/A'})`);
      } else {
        console.warn('[TranslationTest] 翻譯結果為空或無效:', {
          translated_text: translatedText,
          result: result
        });
        setTranslationResult('');
        setMessage('⚠️ 翻譯結果為空，請檢查後端日誌');
      }
    } catch (error) {
      console.error('[TranslationTest] 翻譯失敗:', error);
      setMessage(`❌ 翻譯失敗: ${error}`);
      setTranslationResult('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold mb-4">翻譯模型測試</h2>

      {/* 模型加載 */}
      <div className="space-y-4 p-4 border rounded-lg">
        <h3 className="text-lg font-semibold">1. 加載模型</h3>
        
        <div className="space-y-2">
          <label className="block text-sm font-medium">模型目錄</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={modelDir}
              onChange={(e) => setModelDir(e.target.value)}
              placeholder="選擇包含 encoder_model.onnx 和 decoder_model.onnx 的目錄"
              className="flex-1 px-3 py-2 border rounded"
              disabled={loading}
            />
            <button
              onClick={handleSelectModelDir}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              disabled={loading}
            >
              選擇目錄
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Tokenizer 文件（可選）</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={tokenizerPath}
              onChange={(e) => setTokenizerPath(e.target.value)}
              placeholder="選擇 tokenizer.json 或 vocab.json（可選，會自動查找）"
              className="flex-1 px-3 py-2 border rounded"
              disabled={loading}
            />
            <button
              onClick={handleSelectTokenizer}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              disabled={loading}
            >
              選擇文件
            </button>
          </div>
        </div>

        <button
          onClick={handleLoadModel}
          disabled={loading || !modelDir}
          className="w-full px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400"
        >
          {loading ? '加載中...' : '加載模型'}
        </button>
      </div>

      {/* 翻譯測試 */}
      <div className="space-y-4 p-4 border rounded-lg">
        <h3 className="text-lg font-semibold">2. 測試翻譯</h3>
        
        <div className="space-y-2">
          <label className="block text-sm font-medium">輸入文本（英文）</label>
          <textarea
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            placeholder="輸入要翻譯的英文文本"
            className="w-full px-3 py-2 border rounded"
            rows={3}
            disabled={loading}
          />
        </div>

        <button
          onClick={handleTestTranslation}
          disabled={loading || !testText.trim()}
          className="w-full px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-400"
        >
          {loading ? '翻譯中...' : '測試翻譯'}
        </button>

        {translationResult ? (
          <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded">
            <label className="block text-sm font-medium mb-1 text-gray-900 dark:text-gray-100">翻譯結果（中文）</label>
            <p className="text-lg text-gray-900 dark:text-gray-100">{translationResult || '(空結果)'}</p>
          </div>
        ) : (
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded text-sm text-yellow-800 dark:text-yellow-200">
            暫無翻譯結果
          </div>
        )}
      </div>

      {/* 狀態消息 */}
      {message && (
        <div className={`p-3 rounded ${
          message.startsWith('✅') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {message}
        </div>
      )}

      {/* 測試工具 */}
      <div className="space-y-4 p-4 border rounded-lg">
        <h3 className="text-lg font-semibold">3. 測試工具</h3>
        
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={async () => {
              console.log('開始運行測試...');
              await testTranslation();
            }}
            className="px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600"
          >
            運行完整測試
          </button>
          
          <button
            onClick={async () => {
              console.log('開始對比測試...');
              await compareWithPython();
            }}
            className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600"
          >
            對比 Python 結果
          </button>
          
          <button
            onClick={async () => {
              console.log('開始完整驗證...');
              await runFullVerification();
            }}
            className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
          >
            完整驗證修復
          </button>
        </div>
        
        <div className="text-sm text-gray-600 dark:text-gray-400">
          <p>提示：</p>
          <ul className="list-disc list-inside space-y-1">
            <li>點擊「運行完整測試」會在控制台輸出詳細的測試結果</li>
            <li>點擊「對比 Python 結果」會顯示預期結果和實際結果的對比</li>
            <li>請同時查看後端控制台日誌以獲取完整的調試信息</li>
          </ul>
        </div>
      </div>

      {/* 提示信息 */}
      <div className="p-4 bg-blue-50 rounded-lg text-sm">
        <h4 className="font-semibold mb-2">提示：</h4>
        <ul className="list-disc list-inside space-y-1">
          <li>模型目錄應包含 <code>encoder_model.onnx</code> 和 <code>decoder_model.onnx</code></li>
          <li>如果未指定 Tokenizer，系統會自動查找 <code>tokenizer.json</code> 或 <code>vocab.json</code></li>
          <li>模型目錄示例：<code>models/opus-mt-en-zh-onnx/</code></li>
        </ul>
      </div>
    </div>
  );
}

