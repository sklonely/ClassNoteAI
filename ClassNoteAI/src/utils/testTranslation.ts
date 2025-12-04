/**
 * 翻譯功能測試工具
 * 用於在開發環境中測試翻譯功能
 */

import { invoke } from '@tauri-apps/api/core';

interface TranslationResult {
  translated_text: string;
  source: string;
  confidence?: number;
}

/**
 * 測試翻譯功能
 */
export async function testTranslation() {
  console.log('='.repeat(50));
  console.log('翻譯功能測試');
  console.log('='.repeat(50));

  const modelDir = '/Users/remote_sklonely/eduTranslate/models/opus-mt-en-zh-onnx';
  const tokenizerPath = '/Users/remote_sklonely/eduTranslate/models/opus-mt-en-zh-onnx/tokenizer.json';

  // 測試文本
  const testTexts = [
    'Hello, how are you?',
    'Hello',
    'Hello world',
  ];

  try {
    // 1. 加載模型
    console.log('\n1. 加載模型...');
    console.log(`   模型目錄: ${modelDir}`);
    console.log(`   Tokenizer: ${tokenizerPath}`);
    
    const loadResult = await invoke<string>('load_translation_model', {
      modelDir,
      tokenizerPath: tokenizerPath || null,
    });
    console.log(`   ✓ ${loadResult}`);

    // 2. 測試翻譯
    for (const text of testTexts) {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`測試文本: "${text}"`);
      console.log('='.repeat(50));

      const startTime = Date.now();
      
      try {
        const result = await invoke<TranslationResult>('translate_rough', {
          text,
          sourceLang: 'en',
          targetLang: 'zh',
        });

        const duration = Date.now() - startTime;

        console.log(`\n翻譯結果:`);
        console.log(`   原文: "${text}"`);
        console.log(`   譯文: "${result.translated_text}"`);
        console.log(`   來源: ${result.source}`);
        console.log(`   置信度: ${result.confidence || 'N/A'}`);
        console.log(`   耗時: ${duration}ms`);
        console.log(`   長度: ${result.translated_text.length}`);

        // 檢查結果
        if (!result.translated_text || result.translated_text.trim().length === 0) {
          console.warn('   ⚠️ 翻譯結果為空！');
        } else if (result.translated_text.includes('▁')) {
          console.warn('   ⚠️ 翻譯結果包含 SentencePiece 空格標記（▁）');
        } else {
          console.log('   ✓ 翻譯結果正常');
        }
      } catch (error) {
        console.error(`   ❌ 翻譯失敗: ${error}`);
      }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log('測試完成');
    console.log('='.repeat(50));
  } catch (error) {
    console.error('❌ 測試失敗:', error);
  }
}

/**
 * 對比測試：與 Python 結果對比
 */
export async function compareWithPython() {
  console.log('='.repeat(50));
  console.log('與 Python 結果對比');
  console.log('='.repeat(50));

  const testText = 'Hello, how are you?';
  
  console.log(`\n測試文本: "${testText}"`);
  console.log('\n預期結果（來自 Python 測試）:');
  console.log('  - Input IDs: [3828, 2, 529, 46, 39, 25, 0]');
  console.log('  - Input IDs 長度: 7');
  console.log('  - Encoder hidden states shape: (1, 7, 512)');
  console.log('  - 步驟 0: 下一個 token ID = 5359 (logit = 13.7121)');
  console.log('  - 步驟 0: Token ID 8 的 logit = 11.8986');
  console.log('  - 步驟 1: 下一個 token ID = 0 (EOS)');
  console.log('  - 翻譯結果: "你好"');

  console.log('\n實際結果（來自 Rust 後端）:');
  console.log('  請查看後端控制台日誌，檢查以下項目:');
  console.log('  1. [TranslationModel] Tokenization 結果: 應該是 [3828, 2, 529, 46, 39, 25, 0]');
  console.log('  2. [TranslationModel] Input IDs 長度: 應該是 7');
  console.log('  3. [TranslationModel] Encoder hidden states shape: 應該是 [1, 7, 512]');
  console.log('  4. [TranslationModel] 步驟 0: Token ID 5359 的 logit: 應該約為 13.7');
  console.log('  5. [TranslationModel] 步驟 0: Token ID 8 的 logit: 應該約為 11.9');
  console.log('  6. [TranslationModel] 步驟 0: 下一個 token ID: 應該是 5359');
}

/**
 * 在瀏覽器控制台中使用
 */
if (typeof window !== 'undefined') {
  (window as any).testTranslation = testTranslation;
  (window as any).compareWithPython = compareWithPython;
  
  console.log('測試函數已加載:');
  console.log('  - testTranslation()');
  console.log('  - compareWithPython()');
}


