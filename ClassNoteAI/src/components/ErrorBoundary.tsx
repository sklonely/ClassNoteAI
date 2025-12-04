import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

/**
 * 錯誤邊界組件
 * 捕獲子組件的 JavaScript 錯誤，防止整個應用崩潰
 */
class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
        };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        this.setState({ errorInfo });
        // 記錄錯誤到控制台（未來可擴展為遠程日誌服務）
        console.error('[ErrorBoundary] 捕獲到錯誤:', error);
        console.error('[ErrorBoundary] 錯誤信息:', errorInfo.componentStack);
    }

    handleReset = (): void => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null,
        });
    };

    render(): ReactNode {
        if (this.state.hasError) {
            // 如果提供了自定義 fallback，使用它
            if (this.props.fallback) {
                return this.props.fallback;
            }

            // 默認錯誤 UI
            return (
                <div className="flex flex-col items-center justify-center min-h-[400px] p-8 bg-gray-50 dark:bg-gray-900">
                    <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8 text-center">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                            <AlertTriangle className="w-8 h-8 text-red-500" />
                        </div>

                        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                            出現了一些問題
                        </h2>

                        <p className="text-gray-600 dark:text-gray-400 mb-6">
                            應用程式遇到了錯誤。請嘗試刷新頁面或重新啟動應用。
                        </p>

                        {this.state.error && (
                            <div className="mb-6 p-4 bg-gray-100 dark:bg-gray-700 rounded-lg text-left">
                                <p className="text-sm font-mono text-gray-700 dark:text-gray-300 break-all">
                                    {this.state.error.message}
                                </p>
                            </div>
                        )}

                        <div className="flex gap-3 justify-center">
                            <button
                                onClick={this.handleReset}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                            >
                                <RefreshCw className="w-4 h-4" />
                                重試
                            </button>
                            <button
                                onClick={() => window.location.reload()}
                                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                            >
                                刷新頁面
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
