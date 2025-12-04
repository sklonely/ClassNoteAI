/**
 * 音頻處理工具
 * 實現音頻格式轉換：採樣率轉換、位深度轉換、聲道轉換
 */

/**
 * 將音頻數據轉換為 Whisper 所需的格式
 * - 採樣率：16kHz
 * - 位深度：16-bit
 * - 聲道：Mono
 */
export class AudioProcessor {
  private targetSampleRate: number = 16000;

  constructor(targetSampleRate: number = 16000) {
    this.targetSampleRate = targetSampleRate;
  }

  /**
   * 重採樣：將音頻從一個採樣率轉換到另一個採樣率
   * 使用線性插值方法
   */
  resample(
    inputData: Float32Array | Int16Array,
    inputSampleRate: number,
    outputSampleRate: number
  ): Float32Array {
    if (inputSampleRate === outputSampleRate) {
      // 如果採樣率相同，直接返回（轉換為 Float32）
      if (inputData instanceof Float32Array) {
        return inputData;
      }
      // Int16Array 轉 Float32Array
      return new Float32Array(inputData.map(s => s / 32768));
    }

    // 轉換為 Float32Array（如果需要的話）
    let floatData: Float32Array;
    if (inputData instanceof Int16Array) {
      floatData = new Float32Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        floatData[i] = inputData[i] / 32768;
      }
    } else {
      floatData = inputData;
    }

    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.round(floatData.length / ratio);
    const outputData = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, floatData.length - 1);
      const fraction = srcIndex - srcIndexFloor;

      // 線性插值
      outputData[i] = floatData[srcIndexFloor] * (1 - fraction) + floatData[srcIndexCeil] * fraction;
    }

    return outputData;
  }

  /**
   * 聲道轉換：將立體聲轉換為單聲道
   */
  toMono(inputData: Float32Array, numChannels: number = 2): Float32Array {
    if (numChannels === 1) {
      return inputData;
    }

    const samplesPerChannel = inputData.length / numChannels;
    const monoData = new Float32Array(samplesPerChannel);

    for (let i = 0; i < samplesPerChannel; i++) {
      let sum = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        sum += inputData[i * numChannels + ch];
      }
      monoData[i] = sum / numChannels;
    }

    return monoData;
  }

  /**
   * 位深度轉換：將 Float32 轉換為 Int16
   */
  toInt16(inputData: Float32Array): Int16Array {
    const outputData = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      // 將 Float32 (-1.0 到 1.0) 轉換為 Int16 (-32768 到 32767)
      const sample = Math.max(-1, Math.min(1, inputData[i]));
      outputData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    return outputData;
  }

  /**
   * 完整的音頻格式轉換
   * 將音頻轉換為 Whisper 所需的格式
   */
  convertToWhisperFormat(
    inputData: Float32Array | Int16Array,
    inputSampleRate: number,
    inputChannels: number = 1
  ): Int16Array {
    // console.log('[AudioProcessor] 開始格式轉換:', {
    //   inputSampleRate,
    //   inputChannels,
    //   inputLength: inputData.length,
    //   targetSampleRate: this.targetSampleRate,
    // });

    // 步驟 1: 轉換為 Float32Array（如果需要）
    let floatData: Float32Array;
    if (inputData instanceof Int16Array) {
      floatData = new Float32Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        floatData[i] = inputData[i] / 32768;
      }
    } else {
      floatData = inputData;
    }

    // 步驟 2: 聲道轉換（立體聲 -> 單聲道）
    let monoData = floatData;
    if (inputChannels > 1) {
      monoData = this.toMono(floatData, inputChannels);
      // console.log('[AudioProcessor] 聲道轉換完成:', {
      //   before: floatData.length,
      //   after: monoData.length,
      // });
    }

    // 步驟 3: 採樣率轉換
    let resampledData = monoData;
    if (inputSampleRate !== this.targetSampleRate) {
      resampledData = this.resample(monoData, inputSampleRate, this.targetSampleRate);
      // console.log('[AudioProcessor] 採樣率轉換完成:', {
      //   before: monoData.length,
      //   after: resampledData.length,
      //   beforeRate: inputSampleRate,
      //   afterRate: this.targetSampleRate,
      // });
    }

    // 步驟 4: 位深度轉換（Float32 -> Int16）
    const int16Data = this.toInt16(resampledData);
    // console.log('[AudioProcessor] 位深度轉換完成:', {
    //   before: resampledData.length,
    //   after: int16Data.length,
    // });

    // console.log('[AudioProcessor] 格式轉換完成:', {
    //   finalLength: int16Data.length,
    //   finalSampleRate: this.targetSampleRate,
    //   finalChannels: 1,
    //   finalBitDepth: 16,
    // });

    return int16Data;
  }

  /**
   * 批量處理音頻塊
   * 用於處理連續的音頻數據流
   */
  processChunks(
    chunks: Array<{ data: Float32Array | Int16Array; sampleRate: number; channels?: number }>
  ): Int16Array {
    if (chunks.length === 0) {
      return new Int16Array(0);
    }

    // 合併所有塊
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
    const mergedData = new Float32Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      let floatChunk: Float32Array;
      if (chunk.data instanceof Int16Array) {
        floatChunk = new Float32Array(chunk.data.length);
        for (let i = 0; i < chunk.data.length; i++) {
          floatChunk[i] = chunk.data[i] / 32768;
        }
      } else {
        floatChunk = chunk.data;
      }

      mergedData.set(floatChunk, offset);
      offset += floatChunk.length;
    }

    // 轉換格式
    const sampleRate = chunks[0]?.sampleRate || 48000;
    const channels = chunks[0]?.channels || 1;
    return this.convertToWhisperFormat(mergedData, sampleRate, channels);
  }
}

