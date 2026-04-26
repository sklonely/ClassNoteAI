import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import s from './ErrorBoundary.module.css';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

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
            if (this.props.fallback) {
                return this.props.fallback;
            }

            const stack = this.state.error?.stack ?? '';
            const stackPreview = stack.split('\n').slice(0, 5).join('\n');

            return (
                <div className={s.shell}>
                    <div className={s.body}>
                        <div className={s.glyph}>
                            <AlertTriangle />
                        </div>
                        <div className={s.eyebrow}>UNHANDLED EXCEPTION</div>
                        <h2 className={s.title}>出了點問題</h2>
                        <p className={s.lead}>
                            ClassNote 遇到一個未預期的錯誤。可以試試重試或刷新頁面；如果反覆發生，請複製錯誤訊息回報給開發者。
                        </p>

                        {this.state.error && (
                            <div className={s.codeBlock}>
                                <div className={s.errorLine}>
                                    {this.state.error.message}
                                </div>
                                {stackPreview && (
                                    <div className={s.stackLine}>{stackPreview}</div>
                                )}
                            </div>
                        )}

                        <div className={s.actions}>
                            <button
                                onClick={this.handleReset}
                                className={`${s.btn} ${s.btnPrimary}`}
                            >
                                <RefreshCw size={14} />
                                重試
                            </button>
                            <button
                                onClick={() => window.location.reload()}
                                className={s.btn}
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
