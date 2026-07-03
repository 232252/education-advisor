// =============================================================
// ComboBox 组合框 — 既可下拉选择已有值，也可自由输入
// 仿照 ModelSelector 的 click-outside + popover 范式实现。
// 用于「新建班级」表单的年级/班主任等字段，避免重复输入相同值。
// =============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../i18n'

interface ComboBoxProps {
  /** 当前值（受控） */
  value: string
  /** 值变化回调 */
  onChange: (value: string) => void
  /** 可下拉的候选项 */
  options: string[]
  /** 占位提示文案 */
  placeholder?: string
  /** 是否禁用 */
  disabled?: boolean
  /** 无障碍标签 */
  ariaLabel?: string
  /** 下拉面板最多展示条数（默认 8） */
  maxItems?: number
}

export function ComboBox({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  ariaLabel,
  maxItems = 8,
}: ComboBoxProps) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 过滤：大小写不敏感地包含当前输入；空输入时展示全部
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.toLowerCase().includes(q))
  }, [options, value])

  const visible = useMemo(() => filtered.slice(0, maxItems), [filtered, maxItems])

  // highlight 越界时复位
  useEffect(() => {
    if (highlight >= visible.length) setHighlight(0)
  }, [visible.length, highlight])

  // 点击外部收起
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const pick = (item: string) => {
    onChange(item)
    setOpen(false)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true)
      return
    }
    if (e.key === 'ArrowDown' && visible.length > 0) {
      e.preventDefault()
      setHighlight((h) => (h + 1) % visible.length)
      return
    }
    if (e.key === 'ArrowUp' && visible.length > 0) {
      e.preventDefault()
      setHighlight((h) => (h - 1 + visible.length) % visible.length)
      return
    }
    if (e.key === 'Enter' && open && visible[highlight]) {
      e.preventDefault()
      pick(visible[highlight])
    }
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHighlight(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="w-full px-3 py-1.5 pr-8 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
      />
      {/* 下拉箭头按钮 */}
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o)
          inputRef.current?.focus()
        }}
        aria-label={open ? '收起' : '展开'}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && !disabled && (
        <div className="absolute top-full left-0 mt-1 w-full max-h-60 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg z-50">
          {visible.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
              {t('page.classes.combobox.noMatch', '无匹配项')}
            </div>
          ) : (
            visible.map((item, i) => (
              <button
                type="button"
                key={item}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(item)}
                className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                  i === highlight
                    ? 'bg-blue-600/15 text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {item}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
