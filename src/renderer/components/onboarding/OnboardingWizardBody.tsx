// =============================================================
// OnboardingWizardBody — 首用引导向导本体(经 OnboardingWizard 壳懒加载)
// 触发判定在壳(无完成标记 且 无班级);本文件从 'welcome' 起步,
// 流程: 欢迎 → 建班 → 添加学生 → 启用 Agent → 完成
// 关闭(遮罩/Esc/跳过)即写入完成标记,不再自动弹出。
// 全部 state/effects/handlers/phase 逻辑在此,
// 各步骤 UI 拆分至 ./steps/ 子组件,步骤指示器见 ./StepIndicator。
// =============================================================

import type { AgentListItem } from '@shared/types'
import { Bot, School, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { tr, useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { CARD_BASE, cn } from '../../lib/ui-utils'
import { computeAutoClassId } from '../../pages/Classes/class-id'
import { toast } from '../../stores/toastStore'
import { markOnboardingDone } from './onboarding-done'
import { StepIndicator, type WizardStepDef } from './StepIndicator'
import { AgentsStep } from './steps/AgentsStep'
import { ClassStep } from './steps/ClassStep'
import { DoneStep, type OnboardingSummary } from './steps/DoneStep'
import { StudentsStep } from './steps/StudentsStep'
import { WelcomeStep } from './steps/WelcomeStep'
import { parseStudentNames } from './student-names'

type Phase = 'welcome' | 'class' | 'students' | 'agents' | 'done' | 'closed'

export function OnboardingWizardBody() {
  const { t } = useT()
  const navigate = useNavigate()

  const [phase, setPhase] = useState<Phase>('welcome')
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

  const [summary, setSummary] = useState<OnboardingSummary>({
    className: null,
    studentsAdded: 0,
    studentsFailed: 0,
    agentsEnabled: 0,
  })

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
    if (phase === 'closed') return
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
        toast.success(tr('onboarding.studentsAdded', { 0: String(added) }, '已添加 {0} 名学生'))
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

  // R2+: 未配置模型时从完成页直达模型页(标记向导完成,不阻断后续使用)
  const handleGoModels = () => {
    markOnboardingDone()
    setPhase('closed')
    navigate('/models')
  }

  if (phase === 'closed') return null

  const STEPS: WizardStepDef[] = [
    { key: 'class', icon: School, label: t('onboarding.step.class', '创建班级') },
    { key: 'students', icon: UserPlus, label: t('onboarding.step.students', '添加学生') },
    { key: 'agents', icon: Bot, label: t('onboarding.step.agents', '启用 Agent') },
  ]
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
          <StepIndicator steps={STEPS} stepIndex={stepIndex} />
        )}

        {/* ── 欢迎页 ── */}
        {phase === 'welcome' && (
          <WelcomeStep
            steps={STEPS}
            onSkip={closeAndMark}
            onStart={() => setPhase('class')}
            primaryBtnRef={primaryBtnRef}
          />
        )}

        {/* ── 第 1 步: 创建班级 ── */}
        {phase === 'class' && (
          <ClassStep
            grade={grade}
            className={className}
            classIdManual={classIdManual}
            teacher={teacher}
            creatingClass={creatingClass}
            autoClassId={autoClassId}
            effectiveClassId={effectiveClassId}
            onGradeChange={setGrade}
            onClassNameChange={setClassName}
            onClassIdManualChange={setClassIdManual}
            onTeacherChange={setTeacher}
            onSkip={closeAndMark}
            onCreate={handleCreateClass}
          />
        )}

        {/* ── 第 2 步: 添加学生 ── */}
        {phase === 'students' && (
          <StudentsStep
            studentsText={studentsText}
            addingStudents={addingStudents}
            parsedNames={parsedNames}
            createdClassId={createdClassId}
            onStudentsTextChange={setStudentsText}
            onBack={() => setPhase('class')}
            onSkipStep={() => setPhase('agents')}
            onAdd={handleAddStudents}
          />
        )}

        {/* ── 第 3 步: 启用 Agent ── */}
        {phase === 'agents' && (
          <AgentsStep
            agents={agents}
            agentsLoading={agentsLoading}
            selectedAgentIds={selectedAgentIds}
            enablingAgents={enablingAgents}
            onToggleAgent={toggleAgent}
            onBack={() => setPhase('students')}
            onFinish={handleEnableAgents}
          />
        )}

        {/* ── 完成页 ── */}
        {phase === 'done' && (
          <DoneStep
            summary={summary}
            onFinish={handleFinish}
            onGoModels={handleGoModels}
            primaryBtnRef={primaryBtnRef}
          />
        )}
      </div>
    </div>
  )
}
