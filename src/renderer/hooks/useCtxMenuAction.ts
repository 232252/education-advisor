// =============================================================
// useCtxMenuAction — ContextMenu 右键菜单动作监听
//
// 收口 useSkillsData/useStudentActions/ClassesPage 三处手写的
// document.addEventListener('ctx-menu-action') 样板。
// P1 修复(技能页闭包过期)内建: 回调经 ref 间接调用且在渲染期同步,
// 监听器只注册一次,回调始终执行最新闭包,调用方无需 ref 或依赖数组。
// =============================================================

import { useEffect, useRef } from 'react'

/**
 * 监听一个 data-ctx-* 属性并在事件命中时回调。
 * @param attr     处理器要读取的目标属性名(如 'data-ctx-student-name')
 * @param onAction 回调: action(动作名) / value(属性值,如学生名或班级 id) / target(事件目标元素)
 */
export function useCtxMenuAction(
  attr: string,
  onAction: (action: string, value: string, target: HTMLElement) => void,
) {
  const onActionRef = useRef(onAction)
  onActionRef.current = onAction

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ action: string; target: HTMLElement }>
      const action = ce.detail?.action
      const target = ce.detail?.target
      if (!action || !target) return
      const value = target.getAttribute(attr)
      if (!value) return
      onActionRef.current(action, value, target)
    }
    document.addEventListener('ctx-menu-action', handler)
    return () => document.removeEventListener('ctx-menu-action', handler)
  }, [attr])
}
