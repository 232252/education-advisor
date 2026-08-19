// =============================================================
// OnboardingWizard — 首次使用引导向导
// 触发: 无 localStorage 完成标记 且 当前无任何班级(判定为首次使用)
// 流程: 欢迎 → 建班 → 添加学生 → 启用 Agent → 完成
// 关闭(遮罩/Esc/跳过)即写入完成标记,不再自动弹出。
// =============================================================

import type { AgentListItem } from '@shared/types'
import { Bot, CheckCircle2, School, Sparkles, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { CARD_BASE, cn, INPUT_BASE } from '../../lib/ui-utils'
import { computeAutoClassId } from '../../pages/Classes/class-id'
import { toast } from '../../stores/toastStore'
import { ComboBox } from '../ComboBox'
import { parseStudentNames } from './student-names'

const ONBOARDING_DONE_KEY = 'ea.onboarding.done'

/** 年级预设(初中 + 高中) */
const GRADE_PRESETS = ['七年级', '八年级', '九年级', '高一', '高二', '高三']
/** 班级名预设 */
const NAME_PRESETS = Array.from({ length: 20 }, (_, i) => `${i + 1}班`)

type Phase = 'checking' | 'welcome' | 'class' | 'students' | 'agents' | 'done' | 'closed'

interface Summary {
  className: string | null
  studentsAdded: number
  studentsFailed: number
  agentsEnabled: number
}

/** 写入完成标记(跳过或完成均调用) */
export function markOnboardingDone(): void {
  try {
    localStorage.setItem(ONBOARDING_DONE_KEY, '1')
  } catch {
    /* localStorage 不可用时静默降级 */
  }
}

export function OnboardingWizard() {
  const { t } = useT()
  const navigate = useNavigate()

  const [phase, setPhase] = useState<Phase>('checking')
  // 欢迎/完成页主按钮 — 弹层内接管键盘焦点(替代 autoFocus)
  const primaryBtnRef = useRef<HTMLButtonElement>(null)

  // 第 1 步: 建班表单
  const [grade, setGrade] = useState('七年级')
  const [className, setClassName] = useState('1班')
  const [classIdManual, setClassIdManual] = useState('')
  const [teacher, setTeacher] = useState('')
  const [creatingClass, setCreatingClass] = useState(false)
  /** 已创建(或已存在)班级编号 — 第 2 步学生归属 */
  const [createdClassId, setCreatedClassId] = useState<string | null>(null)

  // 第 2 步: 学生名单
  const [studentsText, setStudentsText] = useState('')
  const [addingStudents, setAddingStudents] = useState(false)

  // 第 3 步: Agent 启用
  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [agentsLoading, setAgentsLoading] = useState(false)
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set())
  const [enablingAgents, setEnablingAgents] = useState(false)

  const [summary, setSummary] = useState<Summary>({
    className: null,
    studentsAdded: 0,
    studentsFailed: 0,
    agentsEnabled: 0,
  })

  // ── 首次使用检测: 无标记 且 无班级 ──
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      let marked = false
      try {
        marked = localStorage.getItem(ONBOARDING_DONE_KEY) === '1'
      } catch {
        marked = false
      }
      if (marked) {
        if (!cancelled) setPhase('closed')
        return
      }
      try {
        const res = await getAPI().class.list()
        // 查询失败 → 无法判断是否首次使用,不打扰用户(下次启动重试,不标记)
        if (!res.success) {
          if (!cancelled) setPhase('closed')
          return
        }
        const hasClass = Array.isArray(res.data) && res.data.length > 0
        if (hasClass) {
          // 已有班级 → 老用户,静默标记并关闭
          markOnboardingDone()
          if (!cancelled) setPhase('closed')
        } else if (!cancelled) {
          setPhase('welcome')
        }
      } catch (err) {
        console.warn('[Onboarding] class list check failed:', err)
        if (!cancelled) setPhase('closed')
      }
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [])

  // 欢迎/完成页: 焦点移入弹层主按钮(键盘可直接回车继续)
  useEffect(() => {
    if (phase !== 'welcome' && phase !== 'done') return
    const raf = requestAnimationFrame(() => primaryBtnRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [phase])

  // 第 3 步进入时加载 Agent 列表(默认勾选全部)
  useEffect(() => {
    if (phase !== 'agents') return
    let cancelled = false
    const load = async () => {
      setAgentsLoading(true)
      try {
        const list = await getAPI().agent.list()
        if (cancelled) return
        setAgents(list)
        setSelectedAgentIds(new Set(list.map((a) => a.id)))
      } catch (err) {
        console.warn('[Onboarding] agent list failed:', err)
        if (!cancelled) setAgents([])
      } finally {
        if (!cancelled) setAgentsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [phase])

  /** 跳过引导: 关闭并标记完成 */
  const closeAndMark = useCallback(() => {
    markOnboardingDone()
    setPhase('closed')
  }, [])

  /** 遮罩点击/Esc = 跳过引导(欢迎页除外,欢迎页点遮罩不关闭防误触) */
  const onOverlayDown = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return
    if (phase === 'welcome') return
    closeAndMark()
  }
  useEffect(() => {
    if (phase === 'closed' || phase === 'checking') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'welcome') closeAndMark()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, closeAndMark])

  const autoClassId = useMemo(() => computeAutoClassId(grade, className) ?? '', [grade, className])
  const effectiveClassId = classIdManual.trim() || autoClassId

  // ── 第 1 步: 创建班级 ──
  const handleCreateClass = async () => {
    if (!effectiveClassId) {
      toast.error(t('onboarding.classIdRequired', '无法生成班级编号，请手动填写'))
      return
    }
    setCreatingClass(true)
    try {
      const res = await getAPI().class.create({
        class_id: effectiveClassId,
        name: className,
        grade: grade || undefined,
        teacher: teacher.trim() || undefined,
      })
      if (!res.success) {
        toast.error(res.error ?? t('onboarding.classCreateFailed', '创建班级失败'))
        return
      }
      setCreatedClassId(effectiveClassId)
      setSummary((s) => ({ ...s, className: className }))
      setPhase('students')
    } catch (err) {
      toast.error(String(err))
    } finally {
      setCreatingClass(false)
    }
  }

  // ── 第 2 步: 批量添加学生 ──
  const parsedNames = useMemo(() => parseStudentNames(studentsText), [studentsText])

  const handleAddStudents = async () => {
    if (parsedNames.length === 0) {
      setPhase('agents')
      return
    }
    setAddingStudents(true)
    let added = 0
    let failed = 0
    try {
      for (const name of parsedNames) {
        try {
          const add = await getAPI().eaa.addStudent(name)
          if (!add.success) {
            failed++
            continue
          }
          if (createdClassId) {
            const assign = await getAPI().class.assign({
              class_id: createdClassId,
              student_names: [name],
            })
            if (!assign.success) {
              // 学生已建,仅归属失败 — 计入失败但不回滚
              failed++
              continue
            }
          }
          added++
        } catch {
          failed++
        }
      }
      setSummary((s) => ({ ...s, studentsAdded: added, studentsFailed: failed }))
      if (added > 0)
        toast.success(
          t('onboarding.studentsAdded', '已添加 {0} 名学生').replace('{0}', String(added)),
        )
      if (failed > 0) {
        toast.error(
          t('onboarding.studentsPartialFailed', '{0} 名学生添加失败').replace(
            '{0}',
            String(failed),
          ),
        )
      }
    } finally {
      setAddingStudents(false)
      setPhase('agents')
    }
  }

  // ── 第 3 步: 启用 Agent ──
  const toggleAgent = (id: string) => {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleEnableAgents = async () => {
    const ids = agents.filter((a) => selectedAgentIds.has(a.id) && !a.enabled).map((a) => a.id)
    if (ids.length === 0) {
      // 无需启用 → 直接完成
      setPhase('done')
      return
    }
    setEnablingAgents(true)
    let enabled = 0
    try {
      for (const id of ids) {
        try {
          const res = await getAPI().agent.toggle(id, true)
          if (res.success) enabled++
        } catch {
          /* 单个失败继续 */
        }
      }
      setSummary((s) => ({ ...s, agentsEnabled: enabled }))
      setPhase('done')
    } finally {
      setEnablingAgents(false)
    }
  }

  // ── 完成页: 关闭并进入仪表盘 ──
  const handleFinish = () => {
    markOnboardingDone()
    setPhase('closed')
    navigate('/dashboard')
  }

  if (phase === 'closed' || phase === 'checking') return null

  const STEPS = [
    { key: 'class', icon: School, label: t('onboarding.step.class', '创建班级') },
    { key: 'students', icon: UserPlus, label: t('onboarding.step.students', '添加学生') },
    { key: 'agents', icon: Bot, label: t('onboarding.step.agents', '启用 Agent') },
  ] as const
  const stepIndex =
    phase === 'welcome' ? -1 : phase === 'done' ? 3 : STEPS.findIndex((s) => s.key === phase)

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[70]"
      onMouseDown={onOverlayDown}
      role="dialog"
      aria-modal="true"
      aria-label={t('onboarding.title', '初始配置向导')}
    >
      <div
        className={cn(
          CARD_BASE,
          'animate-scale-in shadow-2xl w-[560px] max-w-[calc(100vw-48px)] max-h-[calc(100vh-64px)] overflow-y-auto p-6',
        )}
      >
        {/* ── 步骤指示器(欢迎/完成页隐藏) ── */}
        {phase !== 'welcome' && phase !== 'done' && (
          <div className="flex items-center justify-center gap-0 mb-6">
            {STEPS.map((s, i) => {
              const Icon = s.icon
              const state = i < stepIndex ? 'done' : i === stepIndex ? 'active' : 'todo'
              return (
                <div key={s.key} className="flex items-center">
                  {i > 0 && (
                    <span
                      className={cn(
                        'w-10 h-px mx-1',
                        i <= stepIndex ? 'bg-blue-500' : 'bg-gray-200 dark:bg-white/[0.1]',
                      )}
                    />
                  )}
                  <div className="flex flex-col items-center gap-1">
                    <span
                      className={cn(
                        'flex items-center justify-center w-8 h-8 rounded-full border text-xs font-semibold transition-colors',
                        state === 'done' && 'bg-blue-500 border-blue-500 text-white',
                        state === 'active' &&
                          'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10',
                        state === 'todo' &&
                          'border-gray-200 dark:border-white/[0.1] text-gray-400 dark:text-gray-500',
                      )}
                    >
                      {state === 'done' ? <CheckCircle2 size={14} /> : <Icon size={14} />}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] font-medium',
                        state === 'todo'
                          ? 'text-gray-400 dark:text-gray-500'
                          : 'text-gray-700 dark:text-gray-300',
                      )}
                    >
                      {s.label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── 欢迎页 ── */}
        {phase === 'welcome' && (
          <div className="text-center py-4">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-lg shadow-blue-500/25 mx-auto mb-4">
              <Sparkles size={26} />
            </div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1.5">
              {t('onboarding.welcome.title', '欢迎使用 Education Advisor')}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
              {t(
                'onboarding.welcome.desc',
                '智能教育管理助手 — 事件驱动的学生操行记录、学业分析与多 Agent 协作。只需 3 步即可开始使用。',
              )}
            </p>
            <div className="grid grid-cols-3 gap-3 mb-6">
              {STEPS.map((s, i) => {
                const Icon = s.icon
                return (
                  <div
                    key={s.key}
                    className="rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-gray-50/60 dark:bg-white/[0.03] p-3.5 text-center"
                  >
                    <Icon size={20} className="mx-auto text-blue-500 dark:text-blue-400 mb-2" />
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                      {i + 1}. {s.label}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={closeAndMark}
                className="px-4 py-2 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
              >
                {t('onboarding.skip', '跳过引导')}
              </button>
              <button
                type="button"
                onClick={() => setPhase('class')}
                ref={primaryBtnRef}
                className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 shadow-md shadow-blue-500/20 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                {t('onboarding.start', '开始配置')}
              </button>
            </div>
          </div>
        )}

        {/* ── 第 1 步: 创建班级 ── */}
        {phase === 'class' && (
          <div>
            <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-1">
              {t('onboarding.class.title', '创建你的第一个班级')}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {t('onboarding.class.desc', '学生必须归属于班级。选择年级与班号,编号将自动生成。')}
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    {t('onboarding.class.grade', '年级')} *
                  </span>
                  <ComboBox
                    value={grade}
                    onChange={setGrade}
                    options={GRADE_PRESETS}
                    placeholder={t('onboarding.class.grade.ph', '如: 七年级')}
                    ariaLabel={t('onboarding.class.grade', '年级')}
                  />
                </label>
                <label className="block">
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    {t('onboarding.class.name', '班级名称')} *
                  </span>
                  <ComboBox
                    value={className}
                    onChange={setClassName}
                    options={NAME_PRESETS}
                    placeholder={t('onboarding.class.name.ph', '如: 3班')}
                    ariaLabel={t('onboarding.class.name', '班级名称')}
                  />
                </label>
              </div>
              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  {t('onboarding.class.classId', '班级编号')}
                </span>
                <input
                  type="text"
                  value={classIdManual}
                  onChange={(e) => setClassIdManual(e.target.value)}
                  placeholder={autoClassId || 'G7-1'}
                  className={cn('w-full font-mono', INPUT_BASE)}
                />
                <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {effectiveClassId
                    ? t('onboarding.class.classIdPreview', '将使用编号: {0}').replace(
                        '{0}',
                        effectiveClassId,
                      )
                    : t('onboarding.class.classIdHint', '根据年级与班号自动生成,可手动修改')}
                </span>
              </label>
              <label className="block">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  {t('onboarding.class.teacher', '班主任姓名')}
                </span>
                <input
                  type="text"
                  value={teacher}
                  onChange={(e) => setTeacher(e.target.value)}
                  placeholder={t('onboarding.class.teacher.ph', '选填')}
                  className={cn('w-full', INPUT_BASE)}
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={closeAndMark}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                {t('onboarding.skip', '跳过引导')}
              </button>
              <button
                type="button"
                onClick={handleCreateClass}
                disabled={creatingClass || !effectiveClassId}
                className="px-4 py-1.5 rounded-lg text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                {creatingClass
                  ? t('onboarding.creating', '创建中…')
                  : t('onboarding.class.create', '创建班级并继续')}
              </button>
            </div>
          </div>
        )}

        {/* ── 第 2 步: 添加学生 ── */}
        {phase === 'students' && (
          <div>
            <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-1">
              {t('onboarding.students.title', '添加学生名单')}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {createdClassId
                ? t('onboarding.students.desc', '每行一名学生姓名,将加入班级 {0}。').replace(
                    '{0}',
                    createdClassId,
                  )
                : t(
                    'onboarding.students.descNoClass',
                    '每行一名学生姓名。可稍后在「学生」页补充班级归属。',
                  )}
            </p>
            <textarea
              value={studentsText}
              onChange={(e) => setStudentsText(e.target.value)}
              rows={8}
              placeholder={t('onboarding.students.ph', '张三\n李四\n王五')}
              className={cn('w-full font-mono leading-relaxed resize-none', INPUT_BASE)}
              spellCheck={false}
            />
            {parsedNames.length > 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                {t('onboarding.students.count', '识别到 {0} 名学生').replace(
                  '{0}',
                  String(parsedNames.length),
                )}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setPhase('class')}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
              >
                {t('onboarding.back', '上一步')}
              </button>
              <button
                type="button"
                onClick={() => setPhase('agents')}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                {t('onboarding.students.skip', '跳过,稍后导入')}
              </button>
              <button
                type="button"
                onClick={handleAddStudents}
                disabled={addingStudents}
                className="px-4 py-1.5 rounded-lg text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                {addingStudents
                  ? t('onboarding.students.adding', '添加中…')
                  : parsedNames.length > 0
                    ? t('onboarding.students.add', '添加 {0} 名学生并继续').replace(
                        '{0}',
                        String(parsedNames.length),
                      )
                    : t('common.next', '下一步')}
              </button>
            </div>
          </div>
        )}

        {/* ── 第 3 步: 启用 Agent ── */}
        {phase === 'agents' && (
          <div>
            <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-1">
              {t('onboarding.agents.title', '启用智能 Agent')}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {t(
                'onboarding.agents.desc',
                'Agent 负责定期分析学情、生成报告。可现在启用,稍后也可在「Agent」页调整。',
              )}
            </p>
            {agentsLoading ? (
              <div className="py-8 text-center text-xs text-gray-400 dark:text-gray-500">
                {t('common.loading', '加载中...')}
              </div>
            ) : agents.length === 0 ? (
              <div className="py-8 text-center">
                <Bot size={24} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {t('onboarding.agents.empty', '未发现可用 Agent,可稍后在「Agent」页配置')}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {agents.map((a) => {
                  const checked = selectedAgentIds.has(a.id)
                  return (
                    <label
                      key={a.id}
                      className={cn(
                        'flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors',
                        checked
                          ? 'border-blue-300 dark:border-blue-500/40 bg-blue-50/50 dark:bg-blue-500/[0.08]'
                          : 'border-gray-200/80 dark:border-white/[0.06] hover:bg-gray-50 dark:hover:bg-white/[0.03]',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAgent(a.id)}
                        className="mt-0.5 accent-blue-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">
                            {a.name}
                          </span>
                          {a.enabled && (
                            <span className="text-[9px] px-1 py-px rounded bg-green-100 dark:bg-green-500/15 text-green-600 dark:text-green-400 font-medium">
                              {t('onboarding.agents.alreadyEnabled', '已启用')}
                            </span>
                          )}
                        </div>
                        {a.description && (
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                            {a.description}
                          </p>
                        )}
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setPhase('students')}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
              >
                {t('onboarding.back', '上一步')}
              </button>
              <button
                type="button"
                onClick={handleEnableAgents}
                disabled={enablingAgents}
                className="px-4 py-1.5 rounded-lg text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                {enablingAgents
                  ? t('onboarding.agents.enabling', '启用中…')
                  : t('onboarding.finish', '完成配置')}
              </button>
            </div>
          </div>
        )}

        {/* ── 完成页 ── */}
        {phase === 'done' && (
          <div className="text-center py-4">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-green-100 dark:bg-green-500/15 text-green-600 dark:text-green-400 mx-auto mb-4">
              <CheckCircle2 size={28} />
            </div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1.5">
              {t('onboarding.done.title', '配置完成!')}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              {t('onboarding.done.desc', '一切就绪,现在可以开始使用 Education Advisor 了。')}
            </p>
            <div className="rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-gray-50/60 dark:bg-white/[0.03] p-4 space-y-1.5 text-left mb-5">
              <SummaryRow
                icon={School}
                label={t('onboarding.summary.class', '已创建班级')}
                value={summary.className ?? t('onboarding.summary.none', '未配置')}
              />
              <SummaryRow
                icon={UserPlus}
                label={t('onboarding.summary.students', '已添加学生')}
                value={
                  summary.studentsAdded > 0
                    ? `${summary.studentsAdded} ${t('onboarding.summary.people', '名')}` +
                      (summary.studentsFailed > 0
                        ? ` (${summary.studentsFailed} ${t('onboarding.summary.failed', '名失败')})`
                        : '')
                    : t('onboarding.summary.none', '未配置')
                }
              />
              <SummaryRow
                icon={Bot}
                label={t('onboarding.summary.agents', '已启用 Agent')}
                value={
                  summary.agentsEnabled > 0
                    ? `${summary.agentsEnabled} ${t('onboarding.summary.units', '个')}`
                    : t('onboarding.summary.none', '未配置')
                }
              />
            </div>
            <button
              type="button"
              onClick={handleFinish}
              ref={primaryBtnRef}
              className="px-6 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 shadow-md shadow-blue-500/20 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
            >
              {t('onboarding.done.start', '开始使用')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof School
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon size={14} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className="ml-auto text-xs font-semibold text-gray-800 dark:text-gray-200">
        {value}
      </span>
    </div>
  )
}
