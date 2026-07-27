// =============================================================
// ContextMenu — 桌面级自定义右键菜单
// 替代 WebView2/Electron 浏览器默认右键菜单, 提供与应用一致的体验。
//
// 上下文规则:
//   1. input/textarea/contenteditable → 复制/剪切/粘贴/全选 (按选中状态动态启用)
//   2. 带 [data-ctx-menu] 属性的元素 → 读取 data-ctx-* 自定义菜单项
//   3. 其他区域 → 静默禁用浏览器默认菜单 (不弹出任何菜单)
//
// 自定义菜单项用法 (在需要右键菜单的元素上添加):
//   <div data-ctx-menu='[
//     {"label":"查看详情","action":"view"},
//     {"label":"删除","action":"delete","variant":"danger"}
//   ]'
//        data-ctx-student-id='S001'
//        onContextMenu...>
//
//   页面通过 window.dispatchEvent(new CustomEvent('ctx-menu-action', {detail:{action, target}}))
//   或直接在元素上监听该事件来响应操作。
// =============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'

interface MenuItem {
  label: string
  action: string
  variant?: 'default' | 'danger'
  separator?: boolean
}

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
  target: HTMLElement | null
}

const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA'])

function isEditable(el: Element | null): boolean {
  if (!el) return false
  if (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false')
    return true
  const tag = el.tagName
  if (INPUT_TAGS.has(tag)) {
    // 排除 checkbox/radio/button/range 等非文本输入
    const type = (el as HTMLInputElement).type
    return ![
      'checkbox',
      'radio',
      'button',
      'submit',
      'reset',
      'file',
      'hidden',
      'image',
      'range',
      'color',
    ].includes(type)
  }
  return false
}

function hasSelection(): boolean {
  const sel = window.getSelection()
  return !!sel && sel.toString().length > 0
}

/** 解析元素上的 data-ctx-menu 属性, 返回菜单项列表 */
function parseCustomMenu(el: Element): MenuItem[] {
  const raw = el.getAttribute('data-ctx-menu')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // 静默忽略格式错误
  }
  return []
}

/** 为输入框构建编辑菜单项 */
function buildEditMenu(t: (key: string) => string): MenuItem[] {
  const hasSel = hasSelection()
  const editable = document.activeElement && isEditable(document.activeElement)
  const items: MenuItem[] = [
    { label: t('ctxMenu.copy'), action: 'copy', variant: 'default' },
    { label: t('ctxMenu.cut'), action: 'cut', variant: 'default' },
    { label: t('ctxMenu.paste'), action: 'paste', variant: 'default' },
    { label: t('ctxMenu.selectAll'), action: 'selectAll', variant: 'default' },
  ]
  // 动态禁用: copy/cut 需要选中文本, paste 始终启用
  return items.map((item) => {
    if (item.action === 'copy' && !hasSel) return { ...item, action: 'copy_disabled' }
    if (item.action === 'cut' && (!hasSel || !editable)) return { ...item, action: 'cut_disabled' }
    return item
  })
}

/** 执行剪贴板/编辑操作 */
async function executeEditAction(action: string, target: HTMLElement | null) {
  const el = target as HTMLInputElement | HTMLTextAreaElement | null
  switch (action) {
    case 'copy':
      try {
        await navigator.clipboard.writeText(window.getSelection()?.toString() || '')
      } catch {
        document.execCommand('copy')
      }
      break
    case 'cut':
      try {
        await navigator.clipboard.writeText(window.getSelection()?.toString() || '')
        document.execCommand('delete')
      } catch {
        document.execCommand('cut')
      }
      break
    case 'paste': {
      try {
        const text = await navigator.clipboard.readText()
        if (el && isEditable(el)) {
          const start = el.selectionStart ?? 0
          const end = el.selectionEnd ?? 0
          const before = (el as HTMLInputElement).value.substring(0, start)
          const after = (el as HTMLInputElement).value.substring(end)
          ;(el as HTMLInputElement).value = before + text + after
          const newPos = start + text.length
          el.setSelectionRange(newPos, newPos)
          el.dispatchEvent(new Event('input', { bubbles: true }))
        } else {
          document.execCommand('insertText', false, text)
        }
      } catch {
        document.execCommand('paste')
      }
      break
    }
    case 'selectAll':
      if (el && isEditable(el)) {
        el.select()
      } else {
        // 全选页面文本 (非输入框场景)
        const sel = window.getSelection()
        if (sel) {
          const range = document.createRange()
          range.selectNodeContents(document.body)
          sel.removeAllRanges()
          sel.addRange(range)
        }
      }
      break
  }
}

export function ContextMenu() {
  const { t } = useT()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // 用 ref 保存当前 menu 状态, 供 click handler 读取最新值
  const menuRefState = useRef<MenuState | null>(null)
  menuRefState.current = menu
  // 用 ref 保存 t 函数, 避免 handleContextMenu 依赖变化导致重新注册
  const tRef = useRef(t)
  tRef.current = t

  const closeMenu = useCallback(() => {
    setMenu(null)
  }, [])

  const handleContextMenu = useCallback((e: MouseEvent) => {
    // 始终阻止浏览器默认右键菜单
    e.preventDefault()

    const target = e.target as HTMLElement
    const tt = tRef.current

    // 优先级 1: 查找最近的带 [data-ctx-menu] 的祖先元素 → 自定义菜单
    const customEl = target.closest('[data-ctx-menu]') as HTMLElement | null
    if (customEl) {
      const items = parseCustomMenu(customEl)
      if (items.length > 0) {
        setMenu({ x: e.clientX, y: e.clientY, items, target: customEl })
        return
      }
    }

    // 优先级 2: 输入框/文本域 → 编辑菜单 (复制/剪切/粘贴/全选)
    if (isEditable(target)) {
      // 确保 focus 在目标上, 以便后续 execCommand 操作
      ;(target as HTMLElement).focus()
      const items = buildEditMenu(tt)
      setMenu({ x: e.clientX, y: e.clientY, items, target })
      return
    }

    // 优先级 3: 有选中文本但不在输入框 → 只显示复制
    if (hasSelection()) {
      setMenu({
        x: e.clientX,
        y: e.clientY,
        items: [{ label: tt('ctxMenu.copy'), action: 'copy', variant: 'default' }],
        target,
      })
      return
    }

    // 优先级 4: 其他区域 → 不显示任何菜单 (已 preventDefault 禁用浏览器默认菜单)
    setMenu(null)
  }, [])

  const handleMenuItemClick = useCallback(
    async (item: MenuItem) => {
      const currentMenu = menuRefState.current
      if (!currentMenu) return
      const { target } = currentMenu

      // 编辑操作
      if (
        ['copy', 'cut', 'paste', 'selectAll', 'copy_disabled', 'cut_disabled'].includes(item.action)
      ) {
        const realAction = item.action.replace('_disabled', '')
        if (!item.action.endsWith('_disabled')) {
          await executeEditAction(realAction, target)
        }
      } else {
        // 自定义操作: 向目标元素派发事件, 由页面自行处理
        target?.dispatchEvent(
          new CustomEvent('ctx-menu-action', {
            detail: { action: item.action, target },
            bubbles: true,
          }),
        )
      }

      closeMenu()
    },
    [closeMenu],
  )

  // 全局 contextmenu 监听
  useEffect(() => {
    document.addEventListener('contextmenu', handleContextMenu, true)
    return () => document.removeEventListener('contextmenu', handleContextMenu, true)
  }, [handleContextMenu])

  // 关闭菜单: 点击/滚动/Escape/窗口失焦
  useEffect(() => {
    if (!menu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu()
      }
    }
    const handleScroll = () => closeMenu()
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu()
    }
    const handleBlur = () => closeMenu()

    // 用 mousedown 而非 click, 这样在按下时就关闭, 体验更自然
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)
    document.addEventListener('keydown', handleKey)
    window.addEventListener('blur', handleBlur)

    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
      document.removeEventListener('keydown', handleKey)
      window.removeEventListener('blur', handleBlur)
    }
  }, [menu, closeMenu])

  if (!menu) return null

  // 边界检测: 防止菜单超出视口
  const menuWidth = 180
  const menuHeight = menu.items.length * 36 + 8
  const adjustedX = Math.min(menu.x, window.innerWidth - menuWidth - 4)
  const adjustedY = Math.min(menu.y, window.innerHeight - menuHeight - 4)

  return (
    <div
      ref={menuRef}
      className="fixed z-[80] min-w-[160px] py-1 bg-white dark:bg-[#1a1e28] border border-gray-200 dark:border-white/[0.06] rounded-lg shadow-xl select-none"
      style={{ left: adjustedX, top: adjustedY, width: menuWidth }}
      role="menu"
    >
      {menu.items.map((item) => {
        const isDisabled = item.action.endsWith('_disabled')
        const isDanger = item.variant === 'danger'
        return (
          <button
            key={item.action}
            type="button"
            role="menuitem"
            disabled={isDisabled}
            onClick={() => !isDisabled && handleMenuItemClick(item)}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
              isDisabled
                ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                : isDanger
                  ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.04] cursor-pointer'
            }`}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
