// =============================================================
// ErrorBoundary — React 错误边界
// 捕获渲染异常，展示友好的错误提示 UI，防止整页白屏。
// =============================================================

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 可选的自定义回退 UI */
  fallback?: ReactNode
  /**
   * R115 修复: 当 resetKey 变化时重置错误状态 (替代 key={pathname} 方案)。
   * 这样 ErrorBoundary 和子组件不需要 remount, 仅在导航到新路由时清除错误态。
   */
  resetKey?: string | number
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo)
  }

  componentDidUpdate(prevProps: Props) {
    // R115: resetKey 变化时清除错误状态 (例如用户导航到新页面)
    if (this.state.hasError && this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false, error: null })
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children
    if (this.props.fallback) return this.props.fallback

    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
          <svg
            className="w-8 h-8 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
          页面渲染出错了
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mb-4">
          {this.state.error?.message || '发生了未知错误'}
        </p>
        <button
          type="button"
          onClick={() => this.setState({ hasError: false, error: null })}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          重试
        </button>
      </div>
    )
  }
}
