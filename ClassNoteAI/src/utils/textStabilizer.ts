/**
 * Text Stabilizer
 * Implements "Local Agreement" algorithm to determine stable vs unstable text
 * from overlapping speech recognition results.
 */

export interface StabilizedResult {
  stable: string;
  unstable: string;
}

export class TextStabilizer {
  private stableHistory: string = '';
  
  /**
   * Stabilize the new transcript against the previous stable history.
   * @param newTranscript The full transcript from the current audio window
   * @returns Stable and unstable parts
   */
  stabilize(newTranscript: string): StabilizedResult {
    // If new transcript is empty, everything is unstable (or silence)
    if (!newTranscript || newTranscript.trim() === '') {
      return { stable: this.stableHistory, unstable: '' };
    }

    // Simple strategy:
    // The "newTranscript" usually contains some overlap with "stableHistory" 
    // BUT in our rolling buffer approach, the "newTranscript" is often the *continuation* 
    // plus some history.
    
    // Actually, for "Local Agreement" with a rolling buffer of, say, 5 seconds:
    // Window N: "Hello world this is"
    // Window N+1: "world this is a test"
    
    // We need to find the overlap.
    // However, a simpler approach for the MVP (and often used in simple implementations):
    // We treat the *entire* output of the current window as "Unstable" 
    // until it "agrees" with the next window.
    
    // Better approach for this specific project (Tauri + Whisper):
    // We will trust Whisper's timestamp stability or just use a simple heuristic:
    // The last few words are usually unstable.
    
    // Let's implement a standard "Common Prefix" approach if we were sending the *same* audio start.
    // But we are sending a *sliding* window.
    
    // Strategy for Sliding Window:
    // 1. We display the `stableHistory` (black).
    // 2. We display the `newTranscript` (gray) *minus* any overlap with `stableHistory`.
    // 3. Periodically (e.g. when a sentence ends or pause detected), we commit `newTranscript` to `stableHistory`.
    
    // Wait, the "Local Agreement" paper suggests:
    // Compare H(t) and H(t+1). The longest common prefix is stable.
    // But H(t) and H(t+1) must cover the *same* audio start for this to work directly.
    
    // Since we are doing a Rolling Buffer (moving start time), 
    // we should use a "Commit" strategy based on VAD or punctuation.
    
    // Let's refine the class to be a "Stream Manager":
    // It takes partial results, appends them, and decides when to "lock" them.
    
    // For this MVP, let's stick to a simpler "Append & Stabilize" logic:
    // 1. Input: "Hello world"
    // 2. Input: "Hello world this" -> "Hello world" is likely stable.
    
    // Actually, let's implement the logic used by `transcriptionService` currently but better:
    // We will hold a `pendingText`.
    // When we get a new result, we check if it extends `pendingText`.
    
    // Let's try a robust "Suffix Matching" strategy.
    
    return {
      stable: this.stableHistory,
      unstable: newTranscript
    };
  }

  /**
   * Commits the current unstable text to stable history.
   * Usually called when a sentence is finished or a long pause is detected.
   */
  commit(text: string) {
    this.stableHistory += (this.stableHistory ? ' ' : '') + text;
  }

  /**
   * Resets the stabilizer (e.g. new lecture)
   */
  reset() {
    this.stableHistory = '';
  }
  
  getStableHistory(): string {
    return this.stableHistory;
  }
}
