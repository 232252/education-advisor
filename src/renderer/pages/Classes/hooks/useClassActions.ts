// =============================================================
// 班级操作 hook — 存档 / 恢复 / 删除的确认弹窗与执行
// =============================================================

import type { ClassEntity } from '@shared/types'
import { useState } from 'react'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'
import type { ClassCountMap } from './useClassesData'

/** 确认弹窗状态（存档/恢复/删除共用） */
export interface ConfirmState {
  open: boolean
  message: string
  title?: string
  onConfirm: () => void
  variant?: 'default' | 'danger'
}

/** 班级行操作：存档/恢复/删除（带确认） + 操作反馈消息 */
export function useClassActions(counts: ClassCountMap, reload: () => Promise<void>) {
  const { t } = useT()
  const [actionMessage, setActionMessage] = useState('')
  const setActionMessageAuto = useAutoDismiss<string>(setActionMessage, '')
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false,
    message: '',
    onConfirm: () => {},
  })

  const handleArchive = (c: ClassEntity) => {
    setConfirmState({
      open: true,
      message: t('page.classes.archive.confirm').replace('{0}', c.name),
      onConfirm: async () => {
        try {
          const res = await getAPI().class.archive(c.id)
          if (!res.success) {
            toast.error(res.error ?? t('toast.classes.archiveFailed'))
            return
          }
          setActionMessageAuto(`${t('page.classes.status.archived')}: ${c.name}`)
          await reload()
        } catch (err) {
          console.error('[Classes] archive failed:', err)
          toast.error(t('toast.classes.archiveFailed'))
        } finally {
          setConfirmState((prev) => ({ ...prev, open: false }))
        }
      },
    })
  }

  const handleRestore = (c: ClassEntity) => {
    setConfirmState({
      open: true,
      message: t('page.classes.restore.confirm').replace('{0}', c.name),
      onConfirm: async () => {
        try {
          const res = await getAPI().class.restore(c.id)
          if (!res.success) {
            toast.error(res.error ?? t('toast.classes.restoreFailed'))
            return
          }
          setActionMessageAuto(`${t('page.classes.status.active')}: ${c.name}`)
          await reload()
        } catch (err) {
          console.error('[Classes] restore failed:', err)
          toast.error(t('toast.classes.restoreFailed'))
        } finally {
          setConfirmState((prev) => ({ ...prev, open: false }))
        }
      },
    })
  }

  const handleDelete = (c: ClassEntity) => {
    // 班级有一一对应约束: 有学生的班级不能直接删除, 避免产生未分班学生
    const studentCount = counts[c.class_id] ?? 0
    if (studentCount > 0) {
      setConfirmState({
        open: true,
        message: `班级「${c.name}」中还有 ${studentCount} 名学生。\n\n请先在班级详情页将学生转出到其他班级，再删除本班级。\n（学生必须归属于某个班级）`,
        variant: 'danger',
        onConfirm: () => {
          setConfirmState((prev) => ({ ...prev, open: false }))
        },
      })
      return
    }
    setConfirmState({
      open: true,
      message: t('page.classes.delete.confirm').replace('{0}', c.name),
      variant: 'danger',
      onConfirm: async () => {
        try {
          const res = await getAPI().class.delete(c.id)
          if (!res.success) {
            toast.error(res.error ?? t('toast.common.deleteFailed'))
            return
          }
          setActionMessageAuto(`${t('common.delete')}: ${c.name}`)
          await reload()
        } catch (err) {
          console.error('[Classes] delete failed:', err)
          toast.error(t('toast.common.deleteFailed'))
        } finally {
          setConfirmState((prev) => ({ ...prev, open: false }))
        }
      },
    })
  }

  return {
    actionMessage,
    confirmState,
    setConfirmState,
    handleArchive,
    handleRestore,
    handleDelete,
  }
}
