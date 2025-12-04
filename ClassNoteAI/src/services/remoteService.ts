/**
 * 遠程服務管理
 * 管理遠程服務端的連接和配置
 */

import { checkRemoteService as checkService } from './translationService';

class RemoteService {
  private serviceUrl: string | null = null;
  private isAvailable: boolean = false;
  private lastCheckTime: number = 0;
  private checkInterval: number = 30000; // 30 秒檢查一次

  /**
   * 設置遠程服務 URL
   */
  setServiceUrl(url: string | null): void {
    this.serviceUrl = url;
    this.isAvailable = false;
    this.lastCheckTime = 0;
    
    if (url) {
      // 立即檢查一次
      this.checkAvailability();
    }
  }

  /**
   * 獲取遠程服務 URL
   */
  getServiceUrl(): string | null {
    return this.serviceUrl;
  }

  /**
   * 檢查服務是否可用
   */
  async checkAvailability(): Promise<boolean> {
    if (!this.serviceUrl) {
      this.isAvailable = false;
      return false;
    }

    // 如果最近檢查過，直接返回緩存結果
    const now = Date.now();
    if (now - this.lastCheckTime < this.checkInterval && this.isAvailable) {
      return this.isAvailable;
    }

    try {
      this.isAvailable = await checkService(this.serviceUrl);
      this.lastCheckTime = now;
      return this.isAvailable;
    } catch (error) {
      console.error('[RemoteService] 檢查服務可用性失敗:', error);
      this.isAvailable = false;
      return false;
    }
  }

  /**
   * 獲取服務可用狀態（緩存）
   */
  isServiceAvailable(): boolean {
    return this.isAvailable && this.serviceUrl !== null;
  }

  /**
   * 定期檢查服務可用性
   */
  startPeriodicCheck(): void {
    setInterval(() => {
      if (this.serviceUrl) {
        this.checkAvailability();
      }
    }, this.checkInterval);
  }
}

// 導出單例
export const remoteService = new RemoteService();


