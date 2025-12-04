/**
 * 翻譯模型管理組件
 * 提供模型下載、檢查、加載功能
 */

import { useState, useEffect } from 'react';
import { 
  getAvailableTranslationModels, 
  loadTranslationModelByName, 
  downloadTranslationModel
} from '../services/translationModelService';
import { storageService } from '../services/storageService';
import { Download, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

interface TranslationModelInfo {
  name: string;
  displayName: string;
  size: string;
  description: string;
}

const TRANSLATION_MODELS: TranslationModelInfo[] = [
  {
    name: 'opus-mt-en-zh-onnx',
    displayName: 'Opus-MT (英文→中文)',
    size: '~512MB',
    description: '專為英文到中文翻譯優化，速度快，準確度高，推薦使用',
  },
  // 大模型已排除，以確保快速響應
  // {
  //   name: 'nllb-200-distilled-600M-onnx',
  //   displayName: 'NLLB-200 (多語言)',
  //   size: '~4.3GB',
  //   description: '支持多種語言，但文件太大，不適合快速響應',
  // },
  // {
  //   name: 'mbart-large-50-onnx',
  //   displayName: 'MBart-Large-50 (多語言)',
  //   size: '~4.2GB',
  //   description: '大型多語言模型，但文件太大，不適合快速響應',
  // },
];

export default function TranslationModelManager() {
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [modelStatus, setModelStatus] = useState<'checking' | 'not_found' | 'found' | 'downloading' | 'loading' | 'loaded' | 'error'>('checking');
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('檢查模型狀態...');
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  // 加載可用模型列表和保存的選擇
  useEffect(() => {
    loadSavedModel();
    loadAvailableModels();
  }, []);

  // 檢查選中模型的狀態
  useEffect(() => {
    if (selectedModel) {
      checkModelStatus();
    }
  }, [selectedModel]);

  // 自動加載保存的模型（在模型狀態檢查完成後）
  useEffect(() => {
    if (selectedModel && modelStatus === 'found') {
      autoLoadModelIfSaved();
    }
  }, [selectedModel, modelStatus]);

  // 加載保存的模型選擇
  const loadSavedModel = async () => {
    try {
      const settings = await storageService.getAppSettings();
      if (settings?.models?.translation) {
        setSelectedModel(settings.models.translation);
        console.log('[TranslationModelManager] 加載保存的模型選擇:', settings.models.translation);
      }
    } catch (error) {
      console.error('[TranslationModelManager] 加載保存的模型選擇失敗:', error);
    }
  };

  const loadAvailableModels = async () => {
    setIsLoadingModels(true);
    try {
      const models = await getAvailableTranslationModels();
      console.log('[TranslationModelManager] 找到的可用模型:', models);
      
      // 如果有可用模型且沒有保存的選擇，自動選擇第一個
      if (models.length > 0 && !selectedModel) {
        setSelectedModel(models[0]);
      }
    } catch (error) {
      console.error('[TranslationModelManager] 加載模型列表失敗:', error);
      setErrorMessage('無法加載模型列表');
    } finally {
      setIsLoadingModels(false);
    }
  };

  const checkModelStatus = async () => {
    if (!selectedModel) return;
    
    try {
      setModelStatus('checking');
      setStatusMessage('檢查模型文件...');
      setErrorMessage('');
      
      // 檢查模型目錄是否存在
      const models = await getAvailableTranslationModels();
      const exists = models.includes(selectedModel);
      
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

  // 自動加載保存的模型
  const autoLoadModelIfSaved = async () => {
    if (!selectedModel) return;
    
    try {
      const settings = await storageService.getAppSettings();
      const isSavedModel = settings?.models?.translation === selectedModel;
      
      if (isSavedModel && modelStatus === 'found') {
        console.log('[TranslationModelManager] 自動加載保存的模型:', selectedModel);
        try {
          await loadTranslationModelByName(selectedModel);
          setModelStatus('loaded');
          setStatusMessage('模型已自動加載');
        } catch (error) {
          console.error('[TranslationModelManager] 自動加載模型失敗:', error);
          // 自動加載失敗不影響用戶手動加載
        }
      }
    } catch (error) {
      console.error('[TranslationModelManager] 檢查自動加載失敗:', error);
    }
  };

  const handleDownload = async () => {
    if (!selectedModel) {
      setErrorMessage('請先選擇一個模型');
      return;
    }

    try {
      setModelStatus('downloading');
      setDownloadProgress(0);
      setStatusMessage('開始下載模型...');
      setErrorMessage('');
      
      // 獲取項目根目錄下的 models 目錄
      // 在開發模式下，從當前工作目錄查找
      // 在發布模式下，可能需要使用應用數據目錄
      const modelsDir = './models'; // 相對路徑，會自動解析為項目根目錄
      
      // 模擬進度更新
      const progressInterval = setInterval(() => {
        setDownloadProgress((prev) => {
          if (prev >= 95) {
            return 95;
          }
          return prev + 5;
        });
      }, 500);
      
      await downloadTranslationModel(selectedModel, modelsDir, (progress) => {
        setDownloadProgress(progress);
      });
      
      clearInterval(progressInterval);
      setDownloadProgress(100);
      setStatusMessage('下載完成');
      
      // 等待一小段時間確保文件寫入完成
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 重新檢查狀態
      await checkModelStatus();
      
      // 重新加載可用模型列表
      await loadAvailableModels();
    } catch (error) {
      setModelStatus('error');
      const errorMsg = error instanceof Error ? error.message : String(error);
      setErrorMessage(`下載失敗: ${errorMsg}`);
      setStatusMessage('下載失敗');
      
      // 如果錯誤提示需要配置 URL，顯示友好提示
      if (errorMsg.includes('HTTP 404') || errorMsg.includes('下載失敗: HTTP')) {
        setErrorMessage(
          `下載失敗: 模型下載 URL 未配置或無效。\n` +
          `請在 src-tauri/src/translation/download.rs 中配置正確的下載 URL，\n` +
          `或手動將模型文件放置到 models/ 目錄下。`
        );
      }
    }
  };

  // 保存模型選擇到設置
  const saveModelSelection = async (modelName: string) => {
    try {
      const settings = await storageService.getAppSettings();
      const updatedSettings = {
        ...settings,
        models: {
          ...settings?.models,
          translation: modelName,
        },
      };
      await storageService.saveAppSettings(updatedSettings as any);
      console.log('[TranslationModelManager] 保存模型選擇:', modelName);
    } catch (error) {
      console.error('[TranslationModelManager] 保存模型選擇失敗:', error);
    }
  };

  const handleLoadModel = async () => {
    if (!selectedModel) {
      setErrorMessage('請先選擇一個模型');
      return;
    }

    try {
      setModelStatus('loading');
      setStatusMessage('加載模型中...');
      setErrorMessage('');
      
      await loadTranslationModelByName(selectedModel);
      
      // 保存模型選擇
      await saveModelSelection(selectedModel);
      
      setModelStatus('loaded');
      setStatusMessage('模型加載成功');
    } catch (error) {
      setModelStatus('error');
      setErrorMessage(`加載失敗: ${error instanceof Error ? error.message : String(error)}`);
      setStatusMessage('加載失敗');
    }
  };

  const getModelInfo = (modelName: string): TranslationModelInfo | undefined => {
    return TRANSLATION_MODELS.find(m => m.name === modelName);
  };

  const getStatusColor = () => {
    switch (modelStatus) {
      case 'checking':
      case 'loading':
      case 'downloading':
        return 'text-blue-600 dark:text-blue-400';
      case 'found':
      case 'loaded':
        return 'text-green-600 dark:text-green-400';
      case 'not_found':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'error':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  return (
    <div className="mb-6 bg-white dark:bg-slate-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4">翻譯模型管理</h2>
      
      <div className="space-y-4">
        {/* 模型選擇 */}
        <div>
          <label className="block text-sm font-medium mb-2">選擇翻譯模型</label>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={isLoadingModels || modelStatus === 'downloading' || modelStatus === 'loading'}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 disabled:opacity-50"
          >
            <option value="">
              {isLoadingModels ? '加載中...' : '請選擇翻譯模型'}
            </option>
            {TRANSLATION_MODELS.map((model) => (
              <option key={model.name} value={model.name}>
                {model.displayName} ({model.size}) - {model.description}
              </option>
            ))}
          </select>
          {selectedModel && getModelInfo(selectedModel) && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {getModelInfo(selectedModel)!.description}
            </p>
          )}
        </div>

        {/* 狀態顯示 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {modelStatus === 'checking' || modelStatus === 'loading' || modelStatus === 'downloading' ? (
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            ) : modelStatus === 'found' || modelStatus === 'loaded' ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : modelStatus === 'not_found' ? (
              <AlertCircle className="w-5 h-5 text-yellow-500" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-500" />
            )}
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
              className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Download size={18} />
              下載模型
            </button>
          )}

          {modelStatus === 'found' && (
            <>
              <button
                onClick={handleLoadModel}
                className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                加載模型
              </button>
              <button
                onClick={handleDownload}
                className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                重新下載
              </button>
            </>
          )}

          {modelStatus === 'loaded' && (
            <button
              onClick={checkModelStatus}
              className="flex-1 px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              重新檢查
            </button>
          )}

          {(modelStatus === 'error' || modelStatus === 'checking') && (
            <button
              onClick={checkModelStatus}
              disabled={modelStatus === 'checking'}
              className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              重新檢查
            </button>
          )}

          <button
            onClick={loadAvailableModels}
            disabled={isLoadingModels}
            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="刷新模型列表"
          >
            刷新
          </button>
        </div>

        {/* 提示信息 */}
        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1 pt-2 border-t border-gray-200 dark:border-gray-700">
          <p>• 首次使用需要下載或準備模型文件</p>
          <p>• 模型文件應放置在項目根目錄的 models/ 目錄下</p>
          <p>• 每個模型需要包含 encoder_model.onnx 和 decoder_model.onnx 文件</p>
          <p>• 下載完成後需要點擊「加載模型」才能使用</p>
        </div>
      </div>
    </div>
  );
}

