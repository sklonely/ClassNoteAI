/**
 * 翻譯功能修復驗證腳本
 * 用於逐步驗證每個修復點
 */

// 驗證腳本 - 未使用的導入已移除

/**
 * 驗證修復點 1: Tokenization 參數
 * 檢查 Input IDs 是否與 Python 測試一致
 */
export async function verifyTokenizationFix() {
  console.log('='.repeat(60));
  console.log('驗證修復點 1: Tokenization 參數');
  console.log('='.repeat(60));

  const testText = 'Hello, how are you?';
  
  console.log(`\n測試文本: "${testText}"`);
  console.log('\n預期結果（Python 測試）:');
  console.log('  Input IDs: [3828, 2, 529, 46, 39, 25, 0]');
  console.log('  Input IDs 長度: 7');
  console.log('  add_special_tokens: true（包含 EOS token 0）');

  console.log('\n實際結果（Rust 後端）:');
  console.log('  請查看後端控制台日誌:');
  console.log('  - [TranslationModel] Tokenization 結果: 應該是 [3828, 2, 529, 46, 39, 25, 0]');
  console.log('  - [TranslationModel] Input IDs 長度: 應該是 7');
  
  console.log('\n如果結果不一致，請檢查:');
  console.log('  1. Rust 代碼中是否使用 encode(text, true) 而不是 encode(text, false)');
  console.log('  2. tokenizer 的行為是否與 Python transformers 一致');
}

/**
 * 驗證修復點 2: Encoder Hidden States
 * 檢查 encoder_hidden_states 的形狀和數據
 */
export async function verifyEncoderHiddenStates() {
  console.log('='.repeat(60));
  console.log('驗證修復點 2: Encoder Hidden States');
  console.log('='.repeat(60));

  console.log('\n預期結果（Python 測試）:');
  console.log('  Encoder hidden states shape: (1, 7, 512)');
  console.log('  Encoder hidden states data length: 3584 (1 * 7 * 512)');
  console.log('  前5個值: [-0.6083, -0.0536, 0.1600, -0.0150, 0.4816]');
  console.log('  數據不應全為 0');

  console.log('\n實際結果（Rust 後端）:');
  console.log('  請查看後端控制台日誌:');
  console.log('  - [TranslationModel] Encoder hidden states shape: 應該是 [1, 7, 512]');
  console.log('  - [TranslationModel] Encoder hidden states data length: 應該是 3584');
  console.log('  - [TranslationModel] Encoder hidden states 前10個值: 不應全為 0');
  
  console.log('\n如果結果不一致，請檢查:');
  console.log('  1. encoder_hidden_states 的提取是否正確');
  console.log('  2. encoder_hidden_states 的數據順序是否正確（C-contiguous）');
}

/**
 * 驗證修復點 3: Decoder Logits
 * 檢查 decoder 輸出的 logits 值
 */
export async function verifyDecoderLogits() {
  console.log('='.repeat(60));
  console.log('驗證修復點 3: Decoder Logits');
  console.log('='.repeat(60));

  console.log('\n預期結果（Python 測試，步驟 0）:');
  console.log('  下一個 token ID: 5359');
  console.log('  Token ID 5359 的 logit: 13.7121（最高）');
  console.log('  Token ID 8 的 logit: 11.8986（第4高）');
  console.log('  前5個最高 logit:');
  console.log('    [(5359, 13.7121), (32157, 12.0841), (6304, 12.0494), (8, 11.8986), (7999, 11.7388)]');

  console.log('\n實際結果（Rust 後端）:');
  console.log('  請查看後端控制台日誌:');
  console.log('  - [TranslationModel] 步驟 0: Token ID 5359 的 logit: 應該約為 13.7');
  console.log('  - [TranslationModel] 步驟 0: Token ID 8 的 logit: 應該約為 11.9');
  console.log('  - [TranslationModel] 步驟 0: 下一個 token ID: 應該是 5359');
  console.log('  - [TranslationModel] 步驟 0: 前5個最高 logit: 應該與 Python 結果一致');
  
  console.log('\n如果結果不一致，請檢查:');
  console.log('  1. encoder_hidden_states 是否正確傳遞給 decoder');
  console.log('  2. decoder 輸入的順序是否正確（encoder_attention_mask, input_ids, encoder_hidden_states）');
  console.log('  3. logits 的提取方式是否正確');
}

/**
 * 驗證修復點 4: 最終翻譯結果
 * 檢查翻譯結果是否正確
 */
export async function verifyTranslationResult() {
  console.log('='.repeat(60));
  console.log('驗證修復點 4: 最終翻譯結果');
  console.log('='.repeat(60));

  const testText = 'Hello, how are you?';
  
  console.log(`\n測試文本: "${testText}"`);
  console.log('\n預期結果（Python 測試）:');
  console.log('  翻譯結果: "你好"');
  console.log('  生成的 token IDs: [5359]');
  console.log('  步驟 0: 生成 token ID 5359');
  console.log('  步驟 1: 生成 token ID 0 (EOS)，停止');

  console.log('\n實際結果（Rust 後端）:');
  console.log('  請查看後端控制台日誌和前端結果:');
  console.log('  - [TranslationModel] 步驟 0: 下一個 token ID: 應該是 5359');
  console.log('  - [TranslationModel] 步驟 1: 下一個 token ID: 應該是 0 (EOS)');
  console.log('  - [TranslationModel] 生成的 token IDs: 應該是 [5359]');
  console.log('  - 前端翻譯結果: 應該是 "你好"');
  
  console.log('\n如果結果不一致，請檢查:');
  console.log('  1. decoder 的自回歸生成循環是否正確');
  console.log('  2. EOS token 的檢測是否正確');
  console.log('  3. tokenizer 的解碼是否正確');
}

/**
 * 運行完整驗證
 */
export async function runFullVerification() {
  console.log('\n' + '='.repeat(60));
  console.log('開始完整驗證');
  console.log('='.repeat(60));

  await verifyTokenizationFix();
  await verifyEncoderHiddenStates();
  await verifyDecoderLogits();
  await verifyTranslationResult();

  console.log('\n' + '='.repeat(60));
  console.log('驗證完成');
  console.log('='.repeat(60));
  console.log('\n請根據上述檢查點查看後端控制台日誌，確認每個修復點是否正確。');
}

// 在瀏覽器控制台中使用
if (typeof window !== 'undefined') {
  (window as any).verifyTokenizationFix = verifyTokenizationFix;
  (window as any).verifyEncoderHiddenStates = verifyEncoderHiddenStates;
  (window as any).verifyDecoderLogits = verifyDecoderLogits;
  (window as any).verifyTranslationResult = verifyTranslationResult;
  (window as any).runFullVerification = runFullVerification;
  
  console.log('驗證函數已加載:');
  console.log('  - verifyTokenizationFix()');
  console.log('  - verifyEncoderHiddenStates()');
  console.log('  - verifyDecoderLogits()');
  console.log('  - verifyTranslationResult()');
  console.log('  - runFullVerification()');
}


