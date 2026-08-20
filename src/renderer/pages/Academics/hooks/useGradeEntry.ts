// =============================================================
// useGradeEntry — 成绩录入 Tab 全部状态与 handlers
//
// 从 GradeEntryTab 原样搬迁:模式切换/考试选择/已有成绩加载与回填/
// 快速建考试/保存时考试自动解析创建/AI 流式解析。
// 纯逻辑(记录构建、AI 文本解析等)位于 ../lib/grade-entry.ts。
//
// R95 修复保留:AI 流式超时定时器在卸载时清理;
// R112 修复保留:流订阅 unsub 在卸载时立即取消,避免监听器泄漏。
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
import { useT } from '../../../i18n'
import { getCurrentSemester, sortByDateDesc } from '../../../lib/academics'
import { getAPI, getErrorMessage } from '../../../lib/ipc-client'
import { useChatStore } from '../../../stores/chat/store'
import { toast } from '../../../stores/toastStore'
import {
  buildAIGradeSystemPrompt,
  buildAllSaveRecords,
  buildAllScores,
  buildScoresFromClassGrades,
  buildSingleSaveRecords,
  buildSingleScores,
  getActiveStudentNames,
  parseAIGradesText,
  type ScoreEntry,
} from '../lib/grade-entry'

export interface UseGradeEntryArgs {
  studentName: string
  students: EAAStudent[]
  subjects: SubjectDef[]
  subjectMap: Record<string, SubjectDef>
  exams: ExamDef[]
  currentGrades: GradeRecord[]
  onSaved: () => void
  onExamCreated: () => void
}

export function useGradeEntry({
  studentName,
  students,
  subjects,
  subjectMap,
  exams,
  currentGrades,
  onSaved,
  onExamCreated,
}: UseGradeEntryArgs) {
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
  const [singleScores, setSingleScores] = useState<Record<string, ScoreEntry>>({})
  // 全科录入: 科目 → 分数/排名
  const [allScores, setAllScores] = useState<Record<string, ScoreEntry>>({})

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
      setSingleScores(buildSingleScores(currentGrades, selectedExamId, selectedSubjectId))
    } else {
      // 全科模式: 加载当前学生在该考试所有科目的成绩
      setAllScores(buildAllScores(currentGrades, selectedExamId, entryStudentName))
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
          setSingleScores(buildScoresFromClassGrades(res.data))
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
    const name =
      trimmedName ||
      `${t('page.academics.entry.quickEntryPrefix', '快速录入')} ${new Date().toISOString().slice(0, 10)}`
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
    setAiProgress(t('page.academics.ai.parsing', 'AI 解析中...'))

    const studentNames = getActiveStudentNames(students)
    const systemPrompt = buildAIGradeSystemPrompt(studentNames)

    let fullText = ''
    let streamDone = false

    // F1 修复: sessionId 流路由 — 只处理本次 ai.chat 请求的流事件,
    // 过滤同窗口其他请求(如 Chat 页 Agent 流)推送的无关 delta 串扰
    let mySessionId = ''
    // R112: 记录 unsub 到 ref, 组件卸载时立即取消订阅, 避免监听器泄漏
    const unsub = getAPI().ai.onStream(
      (event: { type: string; delta?: string; message?: string; sessionId?: string }) => {
        if (!mySessionId || event.sessionId !== mySessionId) return
        if (event.type === 'text_delta' && event.delta) {
          fullText += event.delta
          setAiProgress(
            `${t('page.academics.ai.received', '已接收')} ${fullText.length} ${t('page.academics.ai.charsUnit', '字符...')}`,
          )
        } else if (event.type === 'done') {
          streamDone = true
          const result = parseAIGradesText(fullText, studentNames)
          if (result.ok) {
            const newScores = result.scores
            setSingleScores((prev) => ({ ...prev, ...newScores }))
            setAiProgress(
              `${t('page.academics.ai.parseDonePrefix', '解析完成: 匹配')} ${result.matched} ${t('page.academics.ai.studentsUnit', '名学生')}`,
            )
            toast.success(
              t('page.academics.toast.aiFilled').replace('{count}', String(result.matched)),
            )
          } else if (result.reason === 'format') {
            setAiProgress(t('page.academics.ai.parseFormatError', '解析失败: AI 返回格式异常'))
            toast.error(t('page.academics.toast.aiFormatError'))
          } else {
            setAiProgress(t('page.academics.ai.parseJsonError', '解析失败: JSON 解析错误'))
            toast.error(t('page.academics.toast.aiParseFailed'))
          }
          setAiParsing(false)
        } else if (event.type === 'error') {
          streamDone = true
          setAiParsing(false)
          setAiProgress(
            `${t('page.academics.ai.errorPrefix', '错误: ')}${event.message ?? t('error.unknown', '未知错误')}`,
          )
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
      const res = await getAPI().ai.chat({
        providerId: currentProvider,
        modelId: currentModel,
        messages: [{ role: 'user', content: aiInputText }],
        systemPrompt,
        maxTokens: 2000,
      })
      // F1: 记录本次请求的 sessionId,供上方 onStream 回调过滤
      // (主进程先回 invoke 再推送流事件,IPC 消息按序到达,此处赋值先于首个流事件)
      mySessionId = res.sessionId ?? ''
    } catch (err) {
      setAiParsing(false)
      setAiProgress(
        `${t('page.academics.ai.callFailedPrefix', '调用失败: ')}${err instanceof Error ? err.message : String(err)}`,
      )
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
          setAiProgress(t('page.academics.ai.timeout', '超时: AI 响应超时'))
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

    const records = buildSingleSaveRecords(singleScores, selectedSubjectId, subject)

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

    const records = buildAllSaveRecords(allScores, entryStudentName, subjectMap)

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

  return {
    // 模式与选择器
    mode,
    setMode,
    selectedExamId,
    setSelectedExamId,
    examNameInput,
    setExamNameInput,
    selectedSubjectId,
    setSelectedSubjectId,
    entryStudentName,
    setEntryStudentName,
    sortedExams,
    selectedExam,
    // 分数表
    singleScores,
    updateSingleScore,
    allScores,
    updateAllScore,
    // 保存
    saving,
    handleSaveSingle,
    handleSaveAll,
    // 快速建考试
    showQuickCreate,
    setShowQuickCreate,
    quickName,
    setQuickName,
    quickType,
    setQuickType,
    quickDate,
    setQuickDate,
    quickCreating,
    handleQuickCreate,
    // AI 智能录入
    showAIEntry,
    setShowAIEntry,
    aiInputText,
    setAiInputText,
    aiParsing,
    aiProgress,
    currentProvider,
    currentModel,
    handleAIParse,
  }
}
