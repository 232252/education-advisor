// =============================================================
// 对话工具的教师点击确认。挂在 App 根上，离开对话页也还在。
// 极致 AI 复用批改页的 ExtremeAiConfirmDialog。
// =============================================================

import type { TeacherConfirmRequest } from '@shared/api/teacher-confirm'
import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { getAPI } from '../lib/ipc-client'
import { ExtremeAiConfirmDialog } from '../pages/Grading/components/ExtremeAiConfirm'
import { ConfirmDialog } from './ConfirmDialog'

export function TeacherConfirmHost() {
  const { t } = useT()
  const [queue, setQueue] = useState<TeacherConfirmRequest[]>([])

  useEffect(() => {
    return getAPI().teacherConfirm.onRequest((req) => {
      setQueue((prev) => [...prev, req])
    })
  }, [])

  const current = queue[0]
  const answer = (accepted: boolean) => {
    if (!current) return
    const id = current.id
    setQueue((prev) => prev.filter((item) => item.id !== id))
    void getAPI().teacherConfirm.respond(id, accepted)
  }

  if (!current) return null

  if (current.kind === 'extreme-grading') {
    return (
      <ExtremeAiConfirmDialog
        open
        detail={current.detail}
        onConfirm={() => answer(true)}
        onCancel={() => answer(false)}
      />
    )
  }

  const message = t('chat.confirm.deleteExam.message', '将删除这场考试及其全部成绩，且不能撤销。')
  return (
    <ConfirmDialog
      open
      variant="danger"
      title={t('chat.confirm.deleteExam.title', '删除这场考试？')}
      message={current.detail ? `${message}\n${current.detail}` : message}
      confirmText={t('chat.confirm.deleteExam.action', '确认删除')}
      cancelText={t('common.cancel', '取消')}
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    />
  )
}
