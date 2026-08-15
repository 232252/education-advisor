// =============================================================
// 学生列表侧边栏 — 班级筛选 + 搜索 + 学生列表 (AcademicsPage 左栏)
// 受控组件: 筛选/搜索状态与派生学生列表由 AcademicsPage 维护
// =============================================================

import type { ClassEntity, EAAStudent } from '@shared/types'
import { GraduationCap, Search, Users } from 'lucide-react'
import { EmptyState } from '../../../components/EmptyState'
import { cn, INPUT_BASE } from '../../../lib/ui-utils'

interface StudentSidebarProps {
  /** 过滤排序后的学生列表 */
  students: EAAStudent[]
  classFilter: string
  onClassFilterChange: (value: string) => void
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  /** 活跃班级列表 (未存档) */
  activeClassList: ClassEntity[]
  /** 班级 ID → 班级名称 */
  classIdToName: Record<string, string>
  selectedStudent: string | null
  onSelectStudent: (name: string) => void
}

export function StudentSidebar({
  students,
  classFilter,
  onClassFilterChange,
  searchQuery,
  onSearchQueryChange,
  activeClassList,
  classIdToName,
  selectedStudent,
  onSelectStudent,
}: StudentSidebarProps) {
  return (
    <aside className="w-64 flex-shrink-0 border-r border-gray-200 dark:border-white/[0.06] bg-white dark:bg-surface-tertiary flex flex-col">
      <div className="p-3 border-b border-gray-200 dark:border-white/[0.06]">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 flex items-center gap-1.5">
          <Users size={16} className="text-gray-400 dark:text-gray-500" />
          <span>学生列表</span>
          <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 font-normal">
            {students.length}
          </span>
        </h2>
        <div className="space-y-2">
          {/* 班级筛选 */}
          <select
            value={classFilter}
            onChange={(e) => onClassFilterChange(e.target.value)}
            className={cn('w-full', INPUT_BASE)}
            title="按班级筛选"
          >
            <option value="__ALL__">全部班级</option>
            <option value="__NONE__">未分班</option>
            {activeClassList.map((c) => (
              <option key={c.class_id} value={c.class_id}>
                {c.name}
              </option>
            ))}
          </select>
          {/* 搜索 */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="搜索学生..."
              className={cn('w-full', INPUT_BASE, 'pl-8')}
            />
            <Search
              size={16}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {students.length === 0 ? (
          <EmptyState
            icon={<GraduationCap size={28} />}
            title={searchQuery || classFilter !== '__ALL__' ? '未找到匹配的学生' : '暂无学生'}
            className="py-12"
          />
        ) : (
          students.map((s) => {
            const clsName = s.class_id ? (classIdToName[s.class_id] ?? null) : null
            return (
              <button
                type="button"
                key={s.entity_id}
                onClick={() => onSelectStudent(s.name)}
                className={cn(
                  'w-full text-left px-3 py-2 flex items-center gap-2 text-sm transition-colors border-l-2',
                  selectedStudent === s.name
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 text-blue-700 dark:text-blue-300 font-medium'
                    : 'border-transparent hover:bg-gray-50 dark:hover:bg-white/[0.04] text-gray-700 dark:text-gray-300',
                )}
              >
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {s.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate">{s.name}</div>
                  {clsName && (
                    <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                      {clsName}
                    </div>
                  )}
                </div>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
