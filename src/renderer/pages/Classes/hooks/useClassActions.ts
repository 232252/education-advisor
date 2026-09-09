// =============================================================
// 班级操作 hook — 存档 / 恢复 / 删除的确认弹窗与执行
// 确认框状态机统一走 useConfirmAction(状态字段与旧本地 ConfirmState 同形)
// =============================================================

import type { ClassEntity } from '@shared/types'
import { useState } from 'react'
import { useAutoDismiss } from '../../../hooks/useAutoDismiss'
import { useConfirmAction } from '../../../hooks/useConfirmAction'
import { tr, useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'
import type { ClassCountMap } from './useClassesData'

/** 班级行操作：存档/恢复/删除（带确认） + 操作反馈消息 */
export function useClassActions(counts: ClassCountMap, reload: () => Promise<void>) {
  const { t } = useT()
  const [actionMessage, setActionMessage] = useState('')
  const setActionMessageAuto = useAutoDismiss<string>(setActionMessage, '')
  const { state: confirmState, setState: setConfirmState, ask, close } = useConfirmAction()

  /** 确认后执行班级操作的公共流程: 失败 toast → 成功消息 + 刷新 → 关闭确认框 */
  const runClassAction = async (
    label: string,
    action: () => Promise<{ success: boolean; error?: string }>,
    failKey: string,
    okText: string,
  ) => {
    try {
      const res = await action()
      if (!res.success) {
        toast.error(res.error ?? t(failKey))
        return
      }
      setActionMessageAuto(okText)
      await reload()
    } catch (err) {
      console.error(`[Classes] ${label} failed:`, err)
      toast.error(t(failKey))
    } finally {
      close()
    }
  }

  const handleArchive = (c: ClassEntity) => {
    ask(tr('page.classes.archive.confirm', { 0: c.name }), () => {
      void runClassAction(
        'archive',
        () => getAPI().class.archive(c.id),
        'toast.classes.archiveFailed',
        `${t('page.classes.status.archived')}: ${c.name}`,
      )
    })
  }

  const handleRestore = (c: ClassEntity) => {
    ask(tr('page.classes.restore.confirm', { 0: c.name }), () => {
      void runClassAction(
        'restore',
        () => getAPI().class.restore(c.id),
        'toast.classes.restoreFailed',
        `${t('page.classes.status.active')}: ${c.name}`,
      )
    })
  }

  const handleDelete = (c: ClassEntity) => {
    // 班级有一一对应约束: 有学生的班级不能直接删除, 避免产生未分班学生
    const studentCount = counts[c.class_id] ?? 0
    if (studentCount > 0) {
      ask(
        tr('page.classes.delete.blocked', { name: c.name, count: studentCount }),
        () => {
          close()
        },
        { variant: 'danger' },
      )
      return
    }
    ask(
      tr('page.classes.delete.confirm', { 0: c.name }),
      () => {
        void runClassAction(
          'delete',
          () => getAPI().class.delete(c.id),
          'toast.common.deleteFailed',
          `${t('common.delete')}: ${c.name}`,
        )
      },
      { variant: 'danger' },
    )
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
