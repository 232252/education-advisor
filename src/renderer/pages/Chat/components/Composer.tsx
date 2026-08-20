// =============================================================
// 输入区 (composer) — 已上传文件列表 + 自动增高输入框 + 发送/停止
// =============================================================

import { Paperclip } from 'lucide-react'
import { type RefObject, useEffect } from 'react'
import { Button } from '../../../components/Button'
import { useT } from '../../../i18n'
import type { UploadedFile } from '../lib/chat-message'

interface ComposerProps {
  input: string
  onInputChange: (v: string) => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  onKeyDown: (e: React.KeyboardEvent) => void
  placeholder: string
  isStreaming: boolean
  canSend: boolean
  uploadedFiles: UploadedFile[]
  onUpload: () => void
  onRemoveFile: (idx: number) => void
  onSend: () => void
  onStop: () => void
}

/** 底部输入区：文件上传 + 多行输入 + 发送/停止按钮 */
export function Composer({
  input,
  onInputChange,
  inputRef,
  onKeyDown,
  placeholder,
  isStreaming,
  canSend,
  uploadedFiles,
  onUpload,
  onRemoveFile,
  onSend,
  onStop,
}: ComposerProps) {
  const { t } = useT()
  // 输入框自动增高：1→6 行平滑增长，超过 6 行才滚动（发送后清空也会复位）
  // input 作为触发器依赖：内容变化(含发送后 setInput(''))时重新调整高度
  // biome-ignore lint/correctness/useExhaustiveDependencies: input 是有意触发器，effect 体内通过 inputRef 读取 DOM
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  return (
    <div className="border-t border-gray-200/60 dark:border-white/[0.06] px-6 py-4 bg-white/80 dark:bg-surface-tertiary/80 backdrop-blur-sm">
      {!canSend && (
        <div className="text-xs text-amber-500 dark:text-amber-400 mb-2 text-center">
          {t('page.chat.composer.loadingAgents', '正在加载 Agent 列表...')}
        </div>
      )}
      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-2 bg-white border border-gray-300 dark:bg-surface-elevated dark:border-white/[0.08] rounded-xl px-3 py-2 focus-within:border-blue-500 dark:focus-within:border-blue-400/60 focus-within:ring-2 focus-within:ring-blue-500/15 dark:focus-within:ring-blue-400/10 transition-all duration-200 shadow-sm">
          {/* 已上传文件列表 */}
          {uploadedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1">
              {uploadedFiles.map((f, idx) => (
                <div
                  key={f.path || `${f.name}-${idx}`}
                  className="flex items-center gap-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-md px-2 py-1 text-[11px]"
                >
                  <Paperclip size={14} className="flex-shrink-0" />
                  <span className="truncate max-w-[160px]" title={f.path}>
                    {f.name}
                  </span>
                  <span className="text-[10px] opacity-70">{(f.size / 1024).toFixed(1)}KB</span>
                  <button
                    type="button"
                    onClick={() => onRemoveFile(idx)}
                    className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-200 ml-0.5"
                    title={t('common.remove', '移除')}
                    aria-label={t('page.chat.composer.removeFile', '移除文件')}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <Button
              variant="secondary"
              onClick={onUpload}
              className="flex-shrink-0"
              aria-label={t('page.chat.composer.upload', '上传文件')}
              title={t('page.chat.composer.uploadTitle', '上传文件 (文本/代码/图片, 最大 10MB)')}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="w-5 h-5"
                role="img"
                aria-label={t('page.chat.composer.upload', '上传文件')}
              >
                <title>{t('page.chat.composer.upload', '上传文件')}</title>
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </Button>
            <textarea
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              rows={1}
              ref={inputRef}
              className="flex-1 bg-transparent border-0 text-sm leading-relaxed focus:outline-none placeholder-gray-400 dark:placeholder-gray-500 resize-none max-h-40 overflow-y-auto py-1 transition-[height] duration-100"
              disabled={isStreaming || !canSend}
            />
          </div>
        </div>
        <Button
          variant={isStreaming ? 'danger' : 'primary'}
          onClick={isStreaming ? onStop : onSend}
          className="self-end px-6 py-3"
          disabled={!isStreaming && (!input.trim() || !canSend)}
          aria-label={
            isStreaming ? t('page.chat.composer.stop', '停止') : t('page.chat.send', '发送')
          }
        >
          {isStreaming ? t('page.chat.composer.stop', '停止') : t('page.chat.send', '发送')}
        </Button>
      </div>
    </div>
  )
}
