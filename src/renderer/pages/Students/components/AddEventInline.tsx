// =============================================================
// AddEventInline — 学生档案头部的"内联添加事件"表单
// 提交后调用 eaa.addEvent,成功则回调 onDone
// =============================================================

import type { EAAReasonCode } from '@shared/types'
import { useState } from 'react'
import { getAPI, getErrorMessage } from '../../../lib/ipc-client'
import { btnStyle, cn, INPUT_BASE } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'

export function AddEventInline({
  studentName,
  reasonCodes,
  onDone,
}: {
  studentName: string
  reasonCodes: EAAReasonCode[]
  onDone: () => void
}) {
  const [reasonCode, setReasonCode] = useState('')
  const [delta, setDelta] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!reasonCode) return
    setSubmitting(true)
    try {
      const result = await getAPI().eaa.addEvent({
        studentName,
        reasonCode,
        delta: delta ? Number.parseFloat(delta) : undefined,
        note: note || undefined,
      })
      if (result.success) {
        onDone()
      } else {
        toast.error(`添加失败: ${getErrorMessage(result)}`)
      }
    } catch (err) {
      toast.error(`提交失败: ${err instanceof Error ? err.message : String(err)}`)
    }
    setSubmitting(false)
  }

  return (
    <div className="px-4 py-3 border-b border-gray-200 dark:border-white/[0.06] bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/10 dark:to-purple-900/10">
      <div className="grid grid-cols-3 gap-2 mb-2">
        <select
          value={reasonCode}
          onChange={(e) => {
            setReasonCode(e.target.value)
            const code = reasonCodes.find((c) => c.code === e.target.value)
            if (code?.score_delta != null) setDelta(String(code.score_delta))
          }}
          className={cn(INPUT_BASE, 'col-span-2 px-2 py-2 text-sm')}
        >
          <option value="">选择原因码...</option>
          {reasonCodes.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label} ({c.code}){' '}
              {c.score_delta != null ? `[${c.score_delta > 0 ? '+' : ''}${c.score_delta}]` : ''}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          placeholder="分数"
          step="0.5"
          className={cn(INPUT_BASE, 'px-2 py-2 text-sm')}
        />
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="备注（可选）"
        className={cn(INPUT_BASE, 'w-full px-2 py-2 text-sm mb-2')}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !reasonCode}
          className={cn(btnStyle('primary'), 'text-xs')}
        >
          {submitting ? '提交中...' : '确认添加'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 text-xs px-2"
        >
          取消
        </button>
      </div>
    </div>
  )
}
