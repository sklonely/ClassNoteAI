/**
 * Whisper 模型管理組件
 * 提供模型下載、檢查、加載功能
 */

import { useState, useEffect } from 'react';
import {
  checkModelFile,
  downloadModel,
  loadModel,
  getModelSize,
  getModelDisplayName,
  type ModelType,
} from '../services/whisperService';

interface WhisperModelManagerProps {
  onModelLoaded?: () => void;
}

export default function WhisperModelManager({ onModelLoaded }: WhisperModelManagerProps) {
  const [selectedModel, setSelectedModel] = useState<ModelType>('base');
  const [modelStatus, setModelStatus] = useState<'checking' | 'not_found' | 'found' | 'downloading' | 'loading' | 'loaded' | 'error'>('checking');
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('檢查模型狀態...');

  // 檢查模型文件是否存在
  useEffect(() => {
    checkModelStatus();
  }, [selectedModel]);

  const checkModelStatus = async () => {
    try {
      setModelStatus('checking');
      setStatusMessage('檢查模型文件...');
      setErrorMessage('');
      
      const exists = await checkModelFile(selectedModel);
      
      if (exists) {
        setModelStatus('found');
        setStatusMessage('模型文件已存在');
      } else {
        setModelStatus('not_found');
        setStatusMessage('模型文件不存在');
      }
    } catch (error) {
      setModelStatus('error');
      setErrorMessage(`檢查失敗: ${error instanceof Error ? error.message : String(error)}`);
      setStatusMessage('檢查失敗');
    }
  };

  const handleDownload = async () => {
    try {
      setModelStatus('downloading');
      setDownloadProgress(0);
      setStatusMessage('開始下載模型...');
      setErrorMessage('');
      
      // 模擬進度更新（實際進度需要通過 Tauri 事件系統獲取）
      const progressInterval = setInterval(() => {
        setDownloadProgress((prev) => {
          if (prev >= 95) {
            clearInterval(progressInterval);
            return 95;
          }
          return prev + 5;
        });
      }, 500);
      
      await downloadModel(selectedModel);
      
      clearInterval(progressInterval);
      setDownloadProgress(100);
      setStatusMessage('下載完成');
      
      // 等待一小段時間確保文件寫入完成
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 重新檢查狀態
      await checkModelStatus();
    } catch (error) {
      setModelStatus('error');
      setErrorMessage(`下載失敗: ${error instanceof Error ? error.message : String(error)}`);
      setStatusMessage('下載失敗');
    }
  };

  const handleLoadModel = async () => {
    try {
      setModelStatus('loading');
      setStatusMessage('加載模型中...');
      setErrorMessage('');
      
      await loadModel(selectedModel);
      
      setModelStatus('loaded');
      setStatusMessage('模型加載成功');
      
      if (onModelLoaded) {
        onModelLoaded();
      }
    } catch (error) {
      setModelStatus('error');
      setErrorMessage(`加載失敗: ${error instanceof Error ? error.message : String(error)}`);
      setStatusMessage('加載失敗');
    }
  };

  const getStatusColor = () => {
    switch (modelStatus) {
      case 'checking':
      case 'loading':
      case 'downloading':
        return 'text-blue-500';
      case 'found':
      case 'loaded':
        return 'text-green-500';
      case 'not_found':
        return 'text-yellow-500';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  const getStatusIcon = () => {
    switch (modelStatus) {
      case 'checking':
      case 'loading':
      case 'downloading':
        return '⏳';
      case 'found':
      case 'loaded':
        return '✅';
      case 'not_found':
        return '⚠️';
      case 'error':
        return '❌';
      default:
        return 'ℹ️';
    }
  };

  return (
    <div className="space-y-4 p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
        Whisper 模型管理
      </h3>

      {/* 模型選擇 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          選擇模型
        </label>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value as ModelType)}
          disabled={modelStatus === 'downloading' || modelStatus === 'loading'}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          <option value="tiny">Tiny (75MB) - 最快，準確度較低</option>
          <option value="base">Base (142MB) - 推薦，平衡速度和準確度</option>
          <option value="small">Small (466MB) - 更準確，較慢</option>
        </select>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {getModelDisplayName(selectedModel)}
        </p>
      </div>

      {/* 狀態顯示 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{getStatusIcon()}</span>
          <span className={`text-sm font-medium ${getStatusColor()}`}>
            {statusMessage}
          </span>
        </div>

        {/* 下載進度條 */}
        {modelStatus === 'downloading' && (
          <div className="space-y-1">
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
              <div
                className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
              {downloadProgress}% - 下載中...
            </p>
          </div>
        )}

        {/* 錯誤訊息 */}
        {errorMessage && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
            <p className="text-sm text-red-800 dark:text-red-200">{errorMessage}</p>
          </div>
        )}
      </div>

      {/* 操作按鈕 */}
      <div className="flex gap-2">
        {modelStatus === 'not_found' && (
          <button
            onClick={handleDownload}
            className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            下載模型 ({getModelSize(selectedModel)}MB)
          </button>
        )}

        {modelStatus === 'found' && (
          <>
            <button
              onClick={handleLoadModel}
              className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              加載模型
            </button>
            <button
              onClick={handleDownload}
              className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              重新下載
            </button>
          </>
        )}

        {modelStatus === 'loaded' && (
          <button
            onClick={checkModelStatus}
            className="flex-1 px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-md transition-colors"
          >
            重新檢查
          </button>
        )}

        {(modelStatus === 'error' || modelStatus === 'checking') && (
          <button
            onClick={checkModelStatus}
            disabled={modelStatus === 'checking'}
            className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            重新檢查
          </button>
        )}
      </div>

      {/* 提示信息 */}
      <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
        <p>• 首次使用需要下載模型文件（約 {getModelSize(selectedModel)}MB）</p>
        <p>• 模型文件會保存在應用數據目錄中</p>
        <p>• 下載完成後需要點擊「加載模型」才能使用</p>
      </div>
    </div>
  );
}

