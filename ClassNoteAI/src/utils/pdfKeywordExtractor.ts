/**
 * PDF 關鍵詞提取工具
 * 從 PDF 文本中提取關鍵詞，用於生成 Whisper 初始提示
 */

/**
 * 提取關鍵詞
 */
export function extractKeywords(text: string): string[] {
  const keywords = new Set<string>();

  // 1. 提取專有名詞（大寫開頭的詞，可能包含多個單詞）
  const properNouns = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
  properNouns.forEach(noun => {
    // 過濾掉太短的詞（少於 2 個字符）
    if (noun.length >= 2) {
      keywords.add(noun);
    }
  });

  // 2. 提取技術術語（常見模式）
  const techTerms = text.match(/\b(API|SDK|UI|UX|HTTP|HTTPS|JSON|XML|HTML|CSS|JS|TS|Rust|Python|Java|C\+\+|React|Vue|Angular|Node|npm|yarn|git|GitHub|GitLab|Docker|Kubernetes|AWS|Azure|GCP|SQL|NoSQL|MongoDB|PostgreSQL|MySQL|Redis|Elasticsearch|TensorFlow|PyTorch|Machine Learning|Deep Learning|Neural Network|Artificial Intelligence|AI|ML|DL|NLP|CV|Computer Vision|Natural Language Processing)\b/gi) || [];
  techTerms.forEach(term => keywords.add(term));

  // 3. 提取高頻詞彙（出現 3 次以上，長度 >= 4）
  const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const wordCount = new Map<string, number>();
  words.forEach(word => {
    wordCount.set(word, (wordCount.get(word) || 0) + 1);
  });
  wordCount.forEach((count, word) => {
    if (count >= 3) {
      keywords.add(word);
    }
  });

  // 4. 提取學術術語（包含常見學術詞彙模式）
  const academicTerms = text.match(/\b(algorithm|data structure|function|variable|class|object|inheritance|polymorphism|encapsulation|abstraction|interface|implementation|design pattern|architecture|component|module|framework|library|package|dependency|import|export|declaration|definition|execution|compilation|runtime|debugging|testing|deployment|optimization|performance|scalability|security|authentication|authorization|encryption|decryption|hash|signature|token|session|cookie|cache|database|query|transaction|index|constraint|foreign key|primary key|normalization|denormalization)\b/gi) || [];
  academicTerms.forEach(term => keywords.add(term.toLowerCase()));

  return Array.from(keywords).slice(0, 30); // 限制數量
}

/**
 * 生成初始提示
 */
export function generateInitialPrompt(keywords: string[]): string {
  const baseTerms = [
    'transcription',
    'lecture',
    'class',
    'student',
    'professor',
    'assignment',
    'homework',
    'exam',
    'quiz',
    'course',
  ];

  const allTerms = [...baseTerms, ...keywords];
  return allTerms.join(', ');
}

/**
 * 從 PDF 文本提取關鍵詞並生成提示
 */
export function extractKeywordsFromPDF(text: string): string {
  const keywords = extractKeywords(text);
  return generateInitialPrompt(keywords);
}

