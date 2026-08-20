// =============================================================
// CommandPalette — 全局搜索命令面板 (Ctrl+K)
// 统一搜索: 学生 / 班级 / Agent / EAA事件 / 页面导航,选择后跳转。
// 数据策略: 学生+班级打开面板时加载并缓存 60s;Agent 订阅 agentStore;
//          事件走 EAA 全文搜索(异步防抖 250ms,仅在输入非空时触发)。
// 跳转协议: /students?entity_id= /classes?class_id= /agents?agent_id=
// =============================================================

import type { ClassEntity, EAAStudent } from '@shared/types'
import { Bot, CornerDownLeft, FileClock, GraduationCap, Search, User, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NAV_ITEMS } from '../../config/nav-items'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { cn } from '../../lib/ui-utils'
import { useAgentStore } from '../../stores/agent/store'
import { usePaletteStore } from '../../stores/paletteStore'
import {
  buildEventResults,
  groupResults,
  type NavCommand,
  type PaletteResult,
  type PaletteResultKind,
  searchLocal,
} from './palette-search'

const DATA_TTL_MS = 60_000
const EVENT_SEARCH_DEBOUNCE_MS = 250

interface PaletteDataCache {
  students: EAAStudent[]
  classes: ClassEntity[]
  at: number
}

const KIND_ICON: Record<PaletteResultKind, typeof User> = {
  student: User,
  class: GraduationCap,
  agent: Bot,
  event: FileClock,
  nav: Search,
}

const KIND_LABEL_KEY: Record<PaletteResultKind, string> = {
  student: 'palette.group.students',
  class: 'palette.group.classes',
  agent: 'palette.group.agents',
  event: 'palette.group.events',
  nav: 'palette.group.navigate',
}

export function CommandPalette() {
  const { t } = useT()
  const navigate = useNavigate()
  const open = usePaletteStore((s) => s.open)
  const setOpen = usePaletteStore((s) => s.setOpen)
  const agents = useAgentStore((s) => s.agents)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [cache, setCache] = useState<PaletteDataCache | null>(null)
  const [eventResults, setEventResults] = useState<PaletteResult[]>([])
  const [eventSearching, setEventSearching] = useState(false)
  const [eventError, setEventError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // ── Ctrl+K / Cmd+K 全局开关(capture 阶段,输入框聚焦时也生效) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        e.stopPropagation()
        usePaletteStore.getState().toggle()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // ── 打开面板: 加载数据(60s 缓存) + 聚焦输入框 ──
  const loadData = useCallback(async () => {
    if (cache && Date.now() - cache.at < DATA_TTL_MS) return
    try {
      const [stuRes, clsRes] = await Promise.all([
        getAPI().eaa.listStudents(),
        getAPI().class.list(),
      ])
      const students =
        stuRes.success && stuRes.data?.students
          ? stuRes.data.students.filter((s) => s.status !== 'Deleted')
          : []
      const classes: ClassEntity[] = clsRes.success && clsRes.data ? clsRes.data : []
      setCache({ students, classes, at: Date.now() })
    } catch (err) {
      console.error('[Palette] load data failed:', err)
      setCache({ students: [], classes: [], at: Date.now() })
    }
  }, [cache])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    setEventResults([])
    setEventError(false)
    void loadData()
    // 挂载后聚焦(等 overlay 渲染完成)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open, loadData])

  // ── 本地搜索结果(学生/班级/Agent/导航) ──
  const navCommands: NavCommand[] = useMemo(
    () =>
      NAV_ITEMS.map((n) => ({
        path: n.path,
        label: t(n.labelKey),
        keywords: n.keywords,
      })),
    [t],
  )

  const localResults = useMemo(
    () =>
      searchLocal(query, {
        students: cache?.students ?? [],
        classes: cache?.classes ?? [],
        agents,
        navCommands,
      }),
    [query, cache, agents, navCommands],
  )

  // ── EAA 事件异步搜索(防抖) ──
  useEffect(() => {
    const q = query.trim()
    if (!open || !q) {
      setEventResults([])
      setEventSearching(false)
      setEventError(false)
      return
    }
    setEventSearching(true)
    setEventError(false)
    const timer = window.setTimeout(async () => {
      try {
        const res = await getAPI().eaa.search(q, 8)
        if (res.success && res.data?.events) {
          setEventResults(buildEventResults(res.data.events))
        } else {
          setEventResults([])
        }
      } catch (err) {
        console.warn('[Palette] event search failed:', err)
        setEventResults([])
        setEventError(true)
      } finally {
        setEventSearching(false)
      }
    }, EVENT_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query, open])

  // ── 汇总 + 分组 ──
  const flatResults = useMemo(
    () => [...localResults, ...eventResults],
    [localResults, eventResults],
  )
  const groups = useMemo(() => groupResults(flatResults), [flatResults])

  // 结果变化时重置选中项(依赖不进 effect 体,故需 ignore)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 结果集变化时重置高亮是刻意行为
  useEffect(() => {
    setActiveIndex(0)
  }, [flatResults])

  // 选中项滚动到可视区
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const selectResult = useCallback(
    (r: PaletteResult) => {
      setOpen(false)
      navigate(r.target)
    },
    [navigate, setOpen],
  )

  // ── 输入框内键盘导航: ↑/↓ 选择, Enter 跳转, Esc 关闭 ──
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (flatResults.length === 0 ? 0 : (i + 1) % flatResults.length))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) =>
        flatResults.length === 0 ? 0 : (i - 1 + flatResults.length) % flatResults.length,
      )
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const r = flatResults[activeIndex]
      if (r) selectResult(r)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[70] flex items-start justify-center pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title', '全局搜索')}
        className="w-[600px] max-w-[92vw] bg-white dark:bg-surface-elevated rounded-xl shadow-2xl border border-gray-200/60 dark:border-white/[0.08] overflow-hidden animate-scale-in"
      >
        {/* 输入行 */}
        <div className="flex items-center gap-3 px-4 h-13 border-b border-gray-200/70 dark:border-white/[0.07]">
          <Search size={18} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={t('palette.placeholder', '搜索学生、班级、Agent、事件记录…')}
            spellCheck={false}
            className="flex-1 h-13 bg-transparent outline-none text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              aria-label={t('common.clear', '清除')}
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.08] transition-colors"
            >
              <X size={14} />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center h-5 px-1.5 rounded font-mono text-[10px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-white/[0.06] flex-shrink-0">
            ESC
          </kbd>
        </div>

        {/* 结果区 */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-2" role="listbox">
          {flatResults.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">
              {eventSearching
                ? t('palette.searching', '搜索中…')
                : t('palette.empty', '未找到匹配结果')}
            </div>
          ) : (
            groups.map((g) => {
              const GroupIcon = KIND_ICON[g.kind]
              const offset = flatResults.indexOf(g.items[0])
              return (
                <div key={g.kind} className="mb-1">
                  <div className="flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                    <GroupIcon size={11} />
                    {t(KIND_LABEL_KEY[g.kind])}
                  </div>
                  {g.items.map((r, i) => {
                    const Icon = KIND_ICON[r.kind]
                    const idx = offset + i
                    const active = idx === activeIndex
                    return (
                      <button
                        key={r.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        data-idx={idx}
                        onMouseMove={() => setActiveIndex(idx)}
                        onClick={() => selectResult(r)}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                          active
                            ? 'bg-blue-50 dark:bg-blue-500/10'
                            : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]',
                        )}
                      >
                        <Icon
                          size={16}
                          className={cn(
                            'flex-shrink-0',
                            active
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-gray-400 dark:text-gray-500',
                          )}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {r.title}
                          </span>
                          {r.subtitle && (
                            <span className="block text-xs text-gray-400 dark:text-gray-500 truncate">
                              {r.subtitle}
                            </span>
                          )}
                        </span>
                        {active && (
                          <CornerDownLeft size={13} className="text-blue-500/70 flex-shrink-0" />
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
          {eventError && flatResults.length > 0 && (
            <div className="px-4 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              {t('palette.searchFailed', '事件搜索失败,仅显示本地结果')}
            </div>
          )}
        </div>

        {/* 底部快捷键提示 */}
        <div className="flex items-center gap-4 px-4 h-9 border-t border-gray-200/70 dark:border-white/[0.07] text-[11px] text-gray-400 dark:text-gray-500 bg-gray-50/60 dark:bg-white/[0.02]">
          <span className="flex items-center gap-1">
            <kbd className="font-mono px-1 rounded bg-gray-100 dark:bg-white/[0.06]">↑↓</kbd>
            {t('palette.hint.navigate', '选择')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-mono px-1 rounded bg-gray-100 dark:bg-white/[0.06]">↵</kbd>
            {t('palette.hint.open', '打开')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-mono px-1 rounded bg-gray-100 dark:bg-white/[0.06]">esc</kbd>
            {t('palette.hint.close', '关闭')}
          </span>
          <span className="ml-auto hidden md:inline">
            {t('palette.hint.shortcut', 'Ctrl+K 随时打开')}
          </span>
        </div>
      </div>
    </div>
  )
}
