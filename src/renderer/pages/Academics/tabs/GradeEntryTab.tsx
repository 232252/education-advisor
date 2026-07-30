// =============================================================
// 成绩录入 Tab — 单科录入(科任老师) / 全科录入(班主任) / AI 智能解析录入
// 含快速创建考试、考试自动解析/创建、AI 流式解析成绩文本
// 复杂度最高,逻辑原样搬迁,未做任何重构
// =============================================================

import type {
  EAAStudent,
  ExamDef,
  ExamType,
  GradeEntryMode,
  GradeRecord,
  SubjectDef,
} from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '../../../components/Badge'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import { getAPI, getErrorMessage } from '../../../lib/ipc-client'
import { btnStyle, cn, INPUT_BASE } from '../../../lib/ui-utils'
import { useChatStore } from '../../../stores/chatStore'
import { toast } from '../../../stores/toastStore'
import {
  EXAM_TYPE_BADGE,
  EXAM_TYPE_LABEL,
  getCurrentSemester,
  sortByDateDesc,
} from '../academics-shared'

export interface GradeEntryTabProps {
  studentName: string
  students: EAAStudent[]
  subjects: SubjectDef[]
  subjectMap: Record<string, SubjectDef>
  exams: ExamDef[]
  examTypes: Array<{ value: ExamType; label: string }>
  currentGrades: GradeRecord[]
  onSaved: () => void
  onExamCreated: () => void
}

export function GradeEntryTab({
  studentName,
  students,
  subjects,
  subjectMap,
  exams,
  examTypes,
  currentGrades,
  onSaved,
  onExamCreated,
}: GradeEntryTabProps) {
  const { t } = useT()
  const [mode, setMode] = useState<GradeEntryMode>('single-subject')
  const [selectedExamId, setSelectedExamId] = useState<string>('')
  const [examNameInput, setExamNameInput] = useState<string>('')
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('')
  const [entryStudentName, setEntryStudentName] = useState<string>(studentName)
  const [saving, setSaving] = useState(false)
  // 快速建考试
  const [showQuickCreate, setShowQuickCreate] = useState(false)
  const [quickName, setQuickName] = useState('')
  const [quickType, setQuickType] = useState<ExamType>('monthly')
  const [quickDate, setQuickDate] = useState('')
  const [quickCreating, setQuickCreating] = useState(false)
  // AI 智能录入
  const [showAIEntry, setShowAIEntry] = useState(false)
  const [aiInputText, setAiInputText] = useState('')
  const [aiParsing, setAiParsing] = useState(false)
  const [aiProgress, setAiProgress] = useState('')
  const currentProvider = useChatStore((s) => s.currentProvider)
  const currentModel = useChatStore((s) => s.currentModel)

  // 单科录入: 学生 → 分数/排名
  const [singleScores, setSingleScores] = useState<Record<string, { score: string; rank: string }>>(
    {},
  )
  // 全科录入: 科目 → 分数/排名
  const [allScores, setAllScores] = useState<Record<string, { score: string; rank: string }>>({})

  const sortedExams = useMemo(() => sortByDateDesc(exams), [exams])

  // R95 修复: 跟踪 AI 流式超时定时器,组件卸载时清理,避免 30s 后调用已卸载组件的 setState
  const aiStreamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // R112 修复: 同样跟踪 unsub 函数,组件卸载时立即取消订阅,避免 IPC_AI_CHAT_STREAM 监听器泄漏
  const aiStreamUnsubRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    return () => {
      if (aiStreamTimerRef.current) {
        clearTimeout(aiStreamTimerRef.current)
        aiStreamTimerRef.current = null
      }
      // 卸载时立即取消订阅,不等 30s 超时
      if (aiStreamUnsubRef.current) {
        aiStreamUnsubRef.current()
        aiStreamUnsubRef.current = null
      }
    }
  }, [])

  // 同步外部学生切换
  useEffect(() => {
    setEntryStudentName(studentName)
  }, [studentName])

  /** 当切换科目/模式/学生时清除成绩; 当切换考试/成绩数据时加载已有成绩 */
  // 注意: 未选考试时不清除成绩,允许用户直接录入(考试在保存时自动创建)
  const prevEntryDepsRef = useRef('')
  useEffect(() => {
    const depsKey = `${selectedSubjectId}|${mode}|${entryStudentName}`
    const depsChanged = prevEntryDepsRef.current !== depsKey
    prevEntryDepsRef.current = depsKey

    if (depsChanged) {
      setSingleScores({})
      setAllScores({})
    }

    if (!selectedExamId) {
      // 未选考试: 不清除已有输入,允许直接录入
      return
    }

    if (mode === 'single-subject') {
      // 单科模式: 加载所有学生在该考试该科目的成绩
      const scores: Record<string, { score: string; rank: string }> = {}
      for (const g of currentGrades) {
        if (g.examId === selectedExamId && g.subjectId === selectedSubjectId) {
          // currentGrades 只包含当前学生, 其他学生的需要通过 getClassGrades 加载
          // 此处先填充当前学生
          scores[g.studentName] = {
            score: g.score != null ? String(g.score) : '',
            rank: g.classRank != null ? String(g.classRank) : '',
          }
        }
      }
      setSingleScores(scores)
    } else {
      // 全科模式: 加载当前学生在该考试所有科目的成绩
      const scores: Record<string, { score: string; rank: string }> = {}
      for (const g of currentGrades) {
        if (g.examId === selectedExamId && g.studentName === entryStudentName) {
          scores[g.subjectId] = {
            score: g.score != null ? String(g.score) : '',
            rank: g.classRank != null ? String(g.classRank) : '',
          }
        }
      }
      setAllScores(scores)
    }
  }, [selectedExamId, selectedSubjectId, mode, entryStudentName, currentGrades])

  /** 加载同班学生在指定考试/科目的成绩 (单科模式) */
  const loadClassGrades = useCallback(
    async (examId: string, subjectId: string) => {
      if (!examId || !subjectId) return
      try {
        const studentNames = students.map((s) => s.name)
        const res = await getAPI().academic.getClassGrades(studentNames, examId, subjectId)
        if (res.success && res.data) {
          const scores: Record<string, { score: string; rank: string }> = {}
          for (const [name, gradeList] of Object.entries(res.data)) {
            const g = gradeList?.[0]
            if (g) {
              scores[name] = {
                score: g.score != null ? String(g.score) : '',
                rank: g.classRank != null ? String(g.classRank) : '',
              }
            }
          }
          setSingleScores(scores)
        }
      } catch (err) {
        console.warn('[GradeEntry] Load class grades failed:', err)
      }
    },
    [students],
  )

  // 单科模式切换考试/科目时,加载班级成绩
  useEffect(() => {
    if (mode === 'single-subject' && selectedExamId && selectedSubjectId) {
      loadClassGrades(selectedExamId, selectedSubjectId)
    }
  }, [mode, selectedExamId, selectedSubjectId, loadClassGrades])

  const selectedExam = useMemo(
    () => exams.find((e) => e.id === selectedExamId) ?? null,
    [exams, selectedExamId],
  )

  /** 快速创建考试 (无需跳转考试管理 Tab) */
  const handleQuickCreate = useCallback(async () => {
    const name = quickName.trim()
    if (!name) {
      toast.error(t('page.academics.toast.examNameRequired'))
      return
    }
    setQuickCreating(true)
    try {
      const semester = getCurrentSemester()
      const res = await getAPI().academic.createExam({
        name,
        type: quickType,
        date: quickDate || new Date().toISOString().slice(0, 10),
        semester,
        scope: '',
        subjects: subjects.map((s) => s.id),
      })
      if (res.success && res.data) {
        toast.success(t('page.academics.toast.examQuickCreated').replace('{name}', name))
        onExamCreated()
        setSelectedExamId(res.data.id)
        setShowQuickCreate(false)
        setQuickName('')
        setQuickDate('')
      } else {
        toast.error(getErrorMessage(res, t('page.academics.toast.createFailed')))
      }
    } catch (err) {
      toast.error(
        t('page.academics.toast.createFailedWithError').replace(
          '{error}',
          err instanceof Error ? err.message : String(err),
        ),
      )
    } finally {
      setQuickCreating(false)
    }
  }, [quickName, quickType, quickDate, subjects, onExamCreated, t])

  /**
   * 解析当前考试: 优先用 selectedExamId; 否则按 examNameInput 查找已有考试;
   * 找不到则自动创建 (名称可选,留空时用"快速录入 YYYY-MM-DD")。
   * 返回 examId 或 null(创建失败时)。
   */
  const resolveExamForSave = useCallback(async (): Promise<string | null> => {
    // 1. 已选择考试
    if (selectedExamId) return selectedExamId

    // 2. 按名称查找已有考试
    const trimmedName = examNameInput.trim()
    if (trimmedName) {
      const existing = exams.find(
        (e) => e.name === trimmedName || e.name.toLowerCase() === trimmedName.toLowerCase(),
      )
      if (existing) {
        setSelectedExamId(existing.id)
        return existing.id
      }
    }

    // 3. 自动创建
    const name = trimmedName || `快速录入 ${new Date().toISOString().slice(0, 10)}`
    try {
      const res = await getAPI().academic.createExam({
        name,
        type: 'other',
        date: new Date().toISOString().slice(0, 10),
        semester: getCurrentSemester(),
        scope: '',
        subjects: subjects.map((s) => s.id),
      })
      if (res.success && res.data) {
        toast.success(t('page.academics.toast.examAutoCreated').replace('{name}', name))
        onExamCreated()
        setSelectedExamId(res.data.id)
        return res.data.id
      }
      toast.error(getErrorMessage(res, t('page.academics.toast.createExamFailed')))
      return null
    } catch (err) {
      toast.error(
        t('page.academics.toast.createExamFailedWithError').replace(
          '{error}',
          err instanceof Error ? err.message : String(err),
        ),
      )
      return null
    }
  }, [selectedExamId, examNameInput, exams, subjects, onExamCreated, t])

  /** AI 智能解析成绩文本,自动填充分数表 */
  const handleAIParse = useCallback(async () => {
    if (!aiInputText.trim()) {
      toast.error(t('page.academics.toast.pasteRequired'))
      return
    }
    if (!currentProvider || !currentModel) {
      toast.error(t('page.academics.toast.aiModelRequired'))
      return
    }
    setAiParsing(true)
    setAiProgress('AI 解析中...')

    const studentNames = students.filter((s) => s.status !== 'Deleted').map((s) => s.name)
    const systemPrompt = `你是一个成绩录入助手。用户会粘贴成绩文本,请将其解析为JSON数组。
格式要求: [{"name":"学生姓名","score":分数,"rank":排名可选}]
学生名单(只解析这些学生): ${studentNames.join('、')}
规则:
1. 尝试模糊匹配文本中的姓名到学生名单
2. score 必须是数字
3. rank 如果文本中有则填数字,没有则不填
4. 只返回JSON数组,不要任何其他文字、不要markdown代码块标记`

    let fullText = ''
    let streamDone = false

    // R112: 记录 unsub 到 ref, 组件卸载时立即取消订阅, 避免监听器泄漏
    const unsub = getAPI().ai.onStream(
      (event: { type: string; delta?: string; message?: string }) => {
        if (event.type === 'text_delta' && event.delta) {
          fullText += event.delta
          setAiProgress(`已接收 ${fullText.length} 字符...`)
        } else if (event.type === 'done') {
          streamDone = true
          try {
            // 从响应中提取 JSON 数组
            const jsonMatch = fullText.match(/\[[\s\S]*\]/)
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]) as Array<{
                name: string
                score?: number
                rank?: number
              }>
              const newScores: Record<string, { score: string; rank: string }> = {}
              let matched = 0
              for (const item of parsed) {
                if (!item.name || item.score == null) continue
                // 模糊匹配学生姓名
                const matchedName = studentNames.find(
                  (n) => n === item.name || n.includes(item.name) || item.name.includes(n),
                )
                if (matchedName) {
                  newScores[matchedName] = {
                    score: String(item.score),
                    rank: item.rank != null ? String(item.rank) : '',
                  }
                  matched++
                }
              }
              setSingleScores((prev) => ({ ...prev, ...newScores }))
              setAiProgress(`解析完成: 匹配 ${matched} 名学生`)
              toast.success(t('page.academics.toast.aiFilled').replace('{count}', String(matched)))
            } else {
              setAiProgress('解析失败: AI 返回格式异常')
              toast.error(t('page.academics.toast.aiFormatError'))
            }
          } catch {
            setAiProgress('解析失败: JSON 解析错误')
            toast.error(t('page.academics.toast.aiParseFailed'))
          }
          setAiParsing(false)
        } else if (event.type === 'error') {
          streamDone = true
          setAiParsing(false)
          setAiProgress(`错误: ${event.message ?? '未知错误'}`)
          toast.error(
            t('page.academics.toast.aiErrorWithMessage').replace(
              '{message}',
              event.message ?? t('error.unknown'),
            ),
          )
        }
      },
    )
    // R112: 保存 unsub 到 ref, 组件卸载时立即取消订阅
    aiStreamUnsubRef.current = unsub

    try {
      await getAPI().ai.chat({
        providerId: currentProvider,
        modelId: currentModel,
        messages: [{ role: 'user', content: aiInputText }],
        systemPrompt,
        maxTokens: 2000,
      })
    } catch (err) {
      setAiParsing(false)
      setAiProgress(`调用失败: ${err instanceof Error ? err.message : String(err)}`)
      toast.error(
        t('page.academics.toast.aiCallFailed').replace(
          '{error}',
          err instanceof Error ? err.message : String(err),
        ),
      )
    } finally {
      // 延迟取消订阅,确保所有流事件都已接收
      // R95 修复: 用 ref 跟踪定时器,组件卸载时清理,避免在已卸载组件上调用 setState
      // R112: 同时清理 unsub ref, 避免重复调用
      aiStreamTimerRef.current = setTimeout(() => {
        aiStreamTimerRef.current = null
        if (!streamDone) {
          setAiParsing(false)
          setAiProgress('超时: AI 响应超时')
        }
        unsub()
        aiStreamUnsubRef.current = null
      }, 30000)
    }
  }, [aiInputText, currentProvider, currentModel, students, t])

  /** 单科模式: 更新学生分数 */
  const updateSingleScore = useCallback((name: string, field: 'score' | 'rank', value: string) => {
    setSingleScores((prev) => ({
      ...prev,
      [name]: {
        score: prev[name]?.score ?? '',
        rank: prev[name]?.rank ?? '',
        [field]: value,
      },
    }))
  }, [])

  /** 全科模式: 更新科目分数 */
  const updateAllScore = useCallback(
    (subjectId: string, field: 'score' | 'rank', value: string) => {
      setAllScores((prev) => ({
        ...prev,
        [subjectId]: {
          score: prev[subjectId]?.score ?? '',
          rank: prev[subjectId]?.rank ?? '',
          [field]: value,
        },
      }))
    },
    [],
  )

  /** 保存单科成绩 (批量) — 考试未选时自动解析/创建 */
  const handleSaveSingle = useCallback(async () => {
    if (!selectedSubjectId) {
      toast.error(t('page.academics.toast.selectSubject'))
      return
    }
    const subject = subjectMap[selectedSubjectId]
    if (!subject) return

    const records = Object.entries(singleScores)
      .filter(([, v]) => v.score !== '')
      .map(([name, v]) => ({
        examId: '', // 占位,下面填充
        subjectId: selectedSubjectId,
        studentName: name,
        score: parseFloat(v.score) || null,
        fullMark: subject.fullMark,
        classRank: v.rank ? parseInt(v.rank, 10) || undefined : undefined,
      }))

    if (records.length === 0) {
      toast.error(t('page.academics.toast.noGradesToSave'))
      return
    }

    setSaving(true)
    try {
      const examId = await resolveExamForSave()
      if (!examId) {
        setSaving(false)
        return
      }
      const finalRecords = records.map((r) => ({ ...r, examId }))
      const res = await getAPI().academic.batchSetGrades(finalRecords)
      if (res.success) {
        toast.success(
          t('page.academics.toast.savedNGrades').replace('{count}', String(finalRecords.length)),
        )
        onSaved()
      } else {
        toast.error(getErrorMessage(res, t('toast.common.saveFailed')))
      }
    } catch (err) {
      toast.error(
        t('page.academics.toast.saveFailedWithError').replace(
          '{error}',
          err instanceof Error ? err.message : String(err),
        ),
      )
    } finally {
      setSaving(false)
    }
  }, [selectedSubjectId, subjectMap, singleScores, resolveExamForSave, onSaved, t])

  /** 保存全科成绩 — 考试未选时自动解析/创建 */
  const handleSaveAll = useCallback(async () => {
    if (!entryStudentName) {
      toast.error(t('page.academics.toast.selectStudent'))
      return
    }

    const records = Object.entries(allScores)
      .filter(([, v]) => v.score !== '')
      .map(([subjectId, v]) => {
        const subject = subjectMap[subjectId]
        return {
          examId: '', // 占位,下面填充
          subjectId,
          studentName: entryStudentName,
          score: parseFloat(v.score) || null,
          fullMark: subject?.fullMark ?? 100,
          classRank: v.rank ? parseInt(v.rank, 10) || undefined : undefined,
        }
      })

    if (records.length === 0) {
      toast.error(t('page.academics.toast.noGradesToSave'))
      return
    }

    setSaving(true)
    try {
      const examId = await resolveExamForSave()
      if (!examId) {
        setSaving(false)
        return
      }
      const finalRecords = records.map((r) => ({ ...r, examId }))
      const res = await getAPI().academic.batchSetGrades(finalRecords)
      if (res.success) {
        toast.success(
          t('page.academics.toast.savedNSubjects').replace('{count}', String(finalRecords.length)),
        )
        onSaved()
      } else {
        toast.error(getErrorMessage(res, t('toast.common.saveFailed')))
      }
    } catch (err) {
      toast.error(
        t('page.academics.toast.saveFailedWithError').replace(
          '{error}',
          err instanceof Error ? err.message : String(err),
        ),
      )
    } finally {
      setSaving(false)
    }
  }, [entryStudentName, subjectMap, allScores, resolveExamForSave, onSaved, t])

  if (showQuickCreate) {
    return (
      <Card padding="lg">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">快速创建考试</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              考试名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={quickName}
              onChange={(e) => setQuickName(e.target.value)}
              placeholder="如: 第一次月考"
              className={cn(INPUT_BASE, 'w-full')}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">考试类型</label>
            <select
              value={quickType}
              onChange={(e) => setQuickType(e.target.value as ExamType)}
              className={cn(INPUT_BASE, 'w-full')}
            >
              {examTypes.map((et) => (
                <option key={et.value} value={et.value}>
                  {et.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              考试日期 <span className="text-gray-400">(可选)</span>
            </label>
            <input
              type="date"
              value={quickDate}
              onChange={(e) => setQuickDate(e.target.value)}
              className={cn(INPUT_BASE, 'w-full')}
            />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={handleQuickCreate}
            disabled={quickCreating || !quickName.trim()}
            className={btnStyle('primary')}
          >
            {quickCreating ? '创建中...' : '创建并录入'}
          </button>
          <button
            type="button"
            onClick={() => setShowQuickCreate(false)}
            className="bg-gray-100 dark:bg-surface-tertiary hover:bg-gray-200 dark:hover:bg-white/[0.06] text-gray-600 dark:text-gray-400 px-4 py-2 rounded-lg text-sm transition-colors"
          >
            取消
          </button>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* 模式切换 + AI 录入入口 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 dark:text-gray-400">录入模式:</span>
        <div className="flex bg-gray-100 dark:bg-surface-tertiary rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setMode('single-subject')}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs transition-colors',
              mode === 'single-subject'
                ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 font-medium shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
            )}
          >
            📝 单科录入 (科任老师)
          </button>
          <button
            type="button"
            onClick={() => setMode('all-subjects')}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs transition-colors',
              mode === 'all-subjects'
                ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 font-medium shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
            )}
          >
            📋 全科录入 (班主任)
          </button>
        </div>
        <button
          type="button"
          onClick={() => setShowAIEntry(!showAIEntry)}
          className={cn(
            'ml-auto px-3 py-1.5 rounded-md text-xs transition-colors border',
            showAIEntry
              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border-purple-300 dark:border-purple-700'
              : 'bg-gray-100 dark:bg-surface-tertiary text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/[0.06] border-transparent',
          )}
          title="粘贴成绩文本,AI 自动解析并填充"
        >
          🤖 AI 智能录入
        </button>
      </div>

      {/* AI 智能录入面板 */}
      {showAIEntry && (
        <Card padding="md">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              🤖 AI 智能录入 — 粘贴文本,自动解析
            </h4>
            <button
              type="button"
              onClick={() => setShowAIEntry(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none"
            >
              ×
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            支持多种格式: &ldquo;张三 85, 李四 92&rdquo;、表格文本、微信聊天记录等。
            {currentProvider && currentModel
              ? ` 当前模型: ${currentProvider}/${currentModel}`
              : ' ⚠️ 请先在"模型"页面配置 AI 模型'}
          </p>
          <textarea
            value={aiInputText}
            onChange={(e) => setAiInputText(e.target.value)}
            placeholder={'粘贴成绩文本,例如:\n张三 85\n李四 92\n王五 78分\n赵六 88 排名3'}
            rows={6}
            className="w-full bg-gray-50 dark:bg-surface-primary border border-gray-200 dark:border-white/[0.06] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 font-mono"
            disabled={aiParsing}
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={handleAIParse}
              disabled={aiParsing || !aiInputText.trim() || !currentProvider || !currentModel}
              className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {aiParsing ? '⏳ 解析中...' : '🤖 AI 解析并填充'}
            </button>
            {aiProgress && (
              <span className="text-xs text-gray-500 dark:text-gray-400">{aiProgress}</span>
            )}
          </div>
          {!currentProvider && (
            <p className="text-xs text-amber-500 mt-2">
              💡 未检测到 AI 模型配置。请先到&ldquo;模型&rdquo;页面选择并配置一个 AI 提供商。
            </p>
          )}
        </Card>
      )}

      {/* 选择器区 */}
      <Card padding="md">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              考试 <span className="text-gray-400 text-[10px]">(可选,留空自动创建)</span>
            </label>
            <div className="flex gap-1.5">
              {sortedExams.length > 0 ? (
                <>
                  <select
                    value={selectedExamId}
                    onChange={(e) => {
                      setSelectedExamId(e.target.value)
                      setExamNameInput('')
                    }}
                    className={cn(INPUT_BASE, 'flex-1')}
                  >
                    <option value="">— 不选,直接录入 —</option>
                    {sortedExams.map((exam) => (
                      <option key={exam.id} value={exam.id}>
                        {exam.name} ({exam.date})
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={examNameInput}
                    onChange={(e) => {
                      setExamNameInput(e.target.value)
                      setSelectedExamId('')
                    }}
                    list="exam-name-suggestions"
                    placeholder="或输入新名称"
                    className={cn(INPUT_BASE, 'flex-1')}
                  />
                  <datalist id="exam-name-suggestions">
                    {sortedExams.map((exam) => (
                      <option key={exam.id} value={exam.name} />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    onClick={() => setShowQuickCreate(true)}
                    className="flex-shrink-0 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 px-2.5 rounded-lg text-sm transition-colors border border-blue-200 dark:border-blue-800"
                    title="快速创建考试(设置类型/日期)"
                  >
                    +
                  </button>
                </>
              ) : (
                <input
                  type="text"
                  value={examNameInput}
                  onChange={(e) => setExamNameInput(e.target.value)}
                  placeholder="输入考试名称(可选),留空保存时自动创建"
                  className="flex-1 bg-gray-50 dark:bg-surface-primary border border-gray-200 dark:border-white/[0.06] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                />
              )}
            </div>
          </div>

          {mode === 'single-subject' ? (
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                科目 <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedSubjectId}
                onChange={(e) => setSelectedSubjectId(e.target.value)}
                className={cn(INPUT_BASE, 'w-full')}
              >
                <option value="">请选择科目...</option>
                {subjects.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name} (满分 {sub.fullMark})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                学生 <span className="text-red-500">*</span>
              </label>
              <select
                value={entryStudentName}
                onChange={(e) => setEntryStudentName(e.target.value)}
                className={cn(INPUT_BASE, 'w-full')}
              >
                <option value="">请选择学生...</option>
                {students
                  .filter((s) => s.status !== 'Deleted')
                  .map((s) => (
                    <option key={s.entity_id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div className="flex items-end">
            {selectedExam && (
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div>
                  类型:{' '}
                  <Badge variant={EXAM_TYPE_BADGE[selectedExam.type]}>
                    {EXAM_TYPE_LABEL[selectedExam.type]}
                  </Badge>
                </div>
                <div>学期: {selectedExam.semester}</div>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* 成绩录入表 */}
      {mode === 'single-subject' ? (
        !selectedSubjectId ? (
          <EmptyState
            icon="👆"
            title="请先选择科目"
            description="选择科目后即可录入成绩,考试可不选"
          />
        ) : (
          <Card padding="md">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                单科成绩录入 — {subjectMap[selectedSubjectId]?.name}
              </h4>
              <button
                type="button"
                onClick={handleSaveSingle}
                disabled={saving}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50 shadow-sm"
              >
                {saving ? '保存中...' : '💾 保存成绩'}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-white/[0.06]">
                    <th className="py-2 px-3 font-medium">学生</th>
                    <th className="py-2 px-3 font-medium text-center">
                      成绩
                      <span className="text-[10px] text-gray-400 ml-1">
                        /{subjectMap[selectedSubjectId]?.fullMark}
                      </span>
                    </th>
                    <th className="py-2 px-3 font-medium text-center">班级排名</th>
                  </tr>
                </thead>
                <tbody>
                  {students
                    .filter((s) => s.status !== 'Deleted')
                    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
                    .map((s) => {
                      const entry = singleScores[s.name]
                      return (
                        <tr
                          key={s.entity_id}
                          className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                        >
                          <td className="py-2 px-3 font-medium text-gray-700 dark:text-gray-200">
                            {s.name}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="number"
                              value={entry?.score ?? ''}
                              onChange={(e) => updateSingleScore(s.name, 'score', e.target.value)}
                              placeholder="-"
                              min="0"
                              max={subjectMap[selectedSubjectId]?.fullMark}
                              step="0.5"
                              className="w-20 text-center bg-gray-50 dark:bg-surface-primary border border-gray-200 dark:border-white/[0.06] rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="number"
                              value={entry?.rank ?? ''}
                              onChange={(e) => updateSingleScore(s.name, 'rank', e.target.value)}
                              placeholder="-"
                              min="1"
                              className="w-16 text-center bg-gray-50 dark:bg-surface-primary border border-gray-200 dark:border-white/[0.06] rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                            />
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </Card>
        )
      ) : !entryStudentName ? (
        <EmptyState icon="👆" title="请先选择学生" description="选择学生后即可录入成绩" />
      ) : (
        <Card padding="md">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              全科成绩录入 — {entryStudentName}
            </h4>
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={saving}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50 shadow-sm"
            >
              {saving ? '保存中...' : '💾 保存成绩'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-white/[0.06]">
                  <th className="py-2 px-3 font-medium">科目</th>
                  <th className="py-2 px-3 font-medium text-center">满分</th>
                  <th className="py-2 px-3 font-medium text-center">成绩</th>
                  <th className="py-2 px-3 font-medium text-center">班级排名</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((sub) => {
                  const entry = allScores[sub.id]
                  return (
                    <tr
                      key={sub.id}
                      className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                    >
                      <td className="py-2 px-3 font-medium text-gray-700 dark:text-gray-200">
                        {sub.name}
                        {sub.isCore && <span className="ml-1 text-[10px] text-blue-500">主科</span>}
                      </td>
                      <td className="py-2 px-3 text-center text-gray-400 dark:text-gray-500 font-mono">
                        {sub.fullMark}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <input
                          type="number"
                          value={entry?.score ?? ''}
                          onChange={(e) => updateAllScore(sub.id, 'score', e.target.value)}
                          placeholder="-"
                          min="0"
                          max={sub.fullMark}
                          step="0.5"
                          className="w-20 text-center bg-gray-50 dark:bg-surface-primary border border-gray-200 dark:border-white/[0.06] rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                        />
                      </td>
                      <td className="py-2 px-3 text-center">
                        <input
                          type="number"
                          value={entry?.rank ?? ''}
                          onChange={(e) => updateAllScore(sub.id, 'rank', e.target.value)}
                          placeholder="-"
                          min="1"
                          className="w-16 text-center bg-gray-50 dark:bg-surface-primary border border-gray-200 dark:border-white/[0.06] rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
