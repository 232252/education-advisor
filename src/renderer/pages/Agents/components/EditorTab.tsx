// =============================================================
// 编辑器 Tab — SOUL.md / AGENTS.md 内容编辑与保存
// =============================================================

import { useEffect, useState } from 'react'
import { btnStyle } from '../../../lib/ui-utils'

interface EditorTabProps {
  content: string
  placeholder: string
  onSave: (content: string) => Promise<void>
}

export function EditorTab({ content, placeholder, onSave }: EditorTabProps) {
  const [text, setText] = useState(content)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // 当切换 agent 时重置
  useEffect(() => {
    setText(content)
    setDirty(false)
  }, [content])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(text)
      setDirty(false)
    } catch (err) {
      // H-4 修复: 保存失败时不能让 saving 永久卡住
      console.warn('[AgentsPage] EditorTab save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-white/[0.06]">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {dirty ? '未保存' : '已保存'}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className={btnStyle('secondary')}
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
        placeholder={placeholder}
        className="flex-1 w-full bg-white text-gray-700 dark:bg-surface-tertiary dark:text-gray-300 p-4 text-sm font-mono resize-none
          focus:outline-none placeholder:text-gray-400 dark:placeholder:text-gray-600"
      />
    </div>
  )
}
