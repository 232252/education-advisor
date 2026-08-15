// =============================================================
// 成绩录入 Tab — 单科录入(科任老师) / 全科录入(班主任) / AI 智能解析录入
//
// 本文件仅做编排:状态与 handlers 在 ../hooks/useGradeEntry.ts,
// UI 块在 ../components/grade-entry/,纯逻辑在 ../lib/grade-entry.ts。
// =============================================================

import type { EAAStudent, ExamDef, ExamType, GradeRecord, SubjectDef } from '@shared/types'
import { EmptyState } from '../../../components/EmptyState'
import {
  AIEntryPanel,
  AllSubjectsTable,
  EntryModeBar,
  EntrySelectorsCard,
  QuickCreateExamCard,
  SingleSubjectTable,
} from '../components/grade-entry'
import { useGradeEntry } from '../hooks/useGradeEntry'
import { getActiveStudentsSorted } from '../lib/grade-entry'

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
  const entry = useGradeEntry({
    studentName,
    students,
    subjects,
    subjectMap,
    exams,
    currentGrades,
    onSaved,
    onExamCreated,
  })

  // 单科表格行序: 过滤未删除学生并按姓名排序
  const activeStudents = getActiveStudentsSorted(students)

  if (entry.showQuickCreate) {
    return (
      <QuickCreateExamCard
        quickName={entry.quickName}
        onQuickNameChange={entry.setQuickName}
        quickType={entry.quickType}
        onQuickTypeChange={entry.setQuickType}
        quickDate={entry.quickDate}
        onQuickDateChange={entry.setQuickDate}
        quickCreating={entry.quickCreating}
        examTypes={examTypes}
        onCreate={entry.handleQuickCreate}
        onCancel={() => entry.setShowQuickCreate(false)}
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* 模式切换 + AI 录入入口 */}
      <EntryModeBar
        mode={entry.mode}
        onModeChange={entry.setMode}
        showAIEntry={entry.showAIEntry}
        onToggleAIEntry={() => entry.setShowAIEntry(!entry.showAIEntry)}
      />

      {/* AI 智能录入面板 */}
      {entry.showAIEntry && (
        <AIEntryPanel
          aiInputText={entry.aiInputText}
          onAiInputTextChange={entry.setAiInputText}
          aiParsing={entry.aiParsing}
          aiProgress={entry.aiProgress}
          currentProvider={entry.currentProvider}
          currentModel={entry.currentModel}
          onParse={entry.handleAIParse}
          onClose={() => entry.setShowAIEntry(false)}
        />
      )}

      {/* 选择器区 */}
      <EntrySelectorsCard
        mode={entry.mode}
        sortedExams={entry.sortedExams}
        selectedExamId={entry.selectedExamId}
        onSelectedExamIdChange={entry.setSelectedExamId}
        examNameInput={entry.examNameInput}
        onExamNameInputChange={entry.setExamNameInput}
        onOpenQuickCreate={() => entry.setShowQuickCreate(true)}
        selectedSubjectId={entry.selectedSubjectId}
        onSelectedSubjectIdChange={entry.setSelectedSubjectId}
        subjects={subjects}
        entryStudentName={entry.entryStudentName}
        onEntryStudentNameChange={entry.setEntryStudentName}
        students={students}
        selectedExam={entry.selectedExam}
      />

      {/* 成绩录入表 */}
      {entry.mode === 'single-subject' ? (
        !entry.selectedSubjectId ? (
          <EmptyState
            icon="👆"
            title="请先选择科目"
            description="选择科目后即可录入成绩,考试可不选"
          />
        ) : (
          <SingleSubjectTable
            subjectName={subjectMap[entry.selectedSubjectId]?.name}
            fullMark={subjectMap[entry.selectedSubjectId]?.fullMark}
            saving={entry.saving}
            onSave={entry.handleSaveSingle}
            students={activeStudents}
            singleScores={entry.singleScores}
            onUpdateScore={entry.updateSingleScore}
          />
        )
      ) : !entry.entryStudentName ? (
        <EmptyState icon="👆" title="请先选择学生" description="选择学生后即可录入成绩" />
      ) : (
        <AllSubjectsTable
          studentName={entry.entryStudentName}
          subjects={subjects}
          allScores={entry.allScores}
          saving={entry.saving}
          onSave={entry.handleSaveAll}
          onUpdateScore={entry.updateAllScore}
        />
      )}
    </div>
  )
}
