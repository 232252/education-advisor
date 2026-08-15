// =============================================================
// ClassComparisonPanel — 班级对比面板（compareMode 开启时显示）
// 上半部：全部活跃班级的对比总览表格
// 下半部：双班级详细对比选择器 + 并排数据卡
// =============================================================

import type { ClassEntity } from '@shared/types'
import { GraduationCap } from 'lucide-react'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/EmptyState'
import { cn, INPUT_BASE, TABLE_ROW, TABLE_TD, TABLE_TH } from '../../../lib/ui-utils'
import type { ClassComparisonItem } from '../dashboard-stats'

/** 对比总览行：在 ClassComparisonItem 基础上补充年级/班主任展示字段 */
export interface ClassComparisonRow extends ClassComparisonItem {
  grade: string
  teacher: string
}

export function ClassComparisonPanel({
  classComparison,
  activeClassList,
  compareClassA,
  compareClassB,
  onCompareClassAChange,
  onCompareClassBChange,
  compareDataA,
  compareDataB,
}: {
  classComparison: ClassComparisonRow[]
  activeClassList: ClassEntity[]
  compareClassA: string
  compareClassB: string
  onCompareClassAChange: (value: string) => void
  onCompareClassBChange: (value: string) => void
  compareDataA: ClassComparisonRow | null
  compareDataB: ClassComparisonRow | null
}) {
  return (
    <Card padding="md" className="shadow-card animate-slide-up overflow-x-auto">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-500"></span>
        班级对比总览
      </h3>
      {classComparison.length === 0 ? (
        <EmptyState icon={<GraduationCap size={28} />} title="暂无班级数据" className="py-6" />
      ) : (
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr>
              <th className={TABLE_TH}>班级</th>
              <th className={TABLE_TH}>年级</th>
              <th className={TABLE_TH}>班主任</th>
              <th className={cn(TABLE_TH, 'text-center')}>学生数</th>
              <th className={cn(TABLE_TH, 'text-center')}>平均分</th>
              <th className={cn(TABLE_TH, 'text-center')}>高风险</th>
              <th className={cn(TABLE_TH, 'text-center')}>极高</th>
              <th className={cn(TABLE_TH, 'text-center')}>高</th>
              <th className={cn(TABLE_TH, 'text-center')}>中</th>
              <th className={cn(TABLE_TH, 'text-center')}>低</th>
            </tr>
          </thead>
          <tbody>
            {classComparison.map((c) => (
              <tr key={c.classId} className={TABLE_ROW}>
                <td className={cn(TABLE_TD, 'font-medium')}>{c.className}</td>
                <td className={cn(TABLE_TD, 'text-gray-500 dark:text-gray-400')}>{c.grade}</td>
                <td className={cn(TABLE_TD, 'text-gray-500 dark:text-gray-400')}>{c.teacher}</td>
                <td className={cn(TABLE_TD, 'text-center font-mono')}>{c.studentCount}</td>
                <td className={cn(TABLE_TD, 'text-center font-mono')}>{c.avgScore.toFixed(1)}</td>
                <td
                  className={cn(
                    TABLE_TD,
                    'text-center font-mono',
                    c.highRisk > 0 && 'text-red-500 dark:text-red-400 font-bold',
                  )}
                >
                  {c.highRisk}
                </td>
                <td className={cn(TABLE_TD, 'text-center text-red-500 dark:text-red-400')}>
                  {c.riskDistribution.极高}
                </td>
                <td className={cn(TABLE_TD, 'text-center text-orange-500 dark:text-orange-400')}>
                  {c.riskDistribution.高}
                </td>
                <td className={cn(TABLE_TD, 'text-center text-yellow-500 dark:text-yellow-400')}>
                  {c.riskDistribution.中}
                </td>
                <td className={cn(TABLE_TD, 'text-center text-green-500 dark:text-green-400')}>
                  {c.riskDistribution.低}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 双班级对比选择器 */}
      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-white/[0.06]">
        <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">
          双班级详细对比
        </h4>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={compareClassA}
            onChange={(e) => onCompareClassAChange(e.target.value)}
            className={INPUT_BASE}
            aria-label="选择对比班级 A"
          >
            <option value="">选择班级 A...</option>
            {activeClassList.map((c) => (
              <option key={c.id} value={c.class_id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="text-gray-400 dark:text-gray-500 text-xs font-medium">VS</span>
          <select
            value={compareClassB}
            onChange={(e) => onCompareClassBChange(e.target.value)}
            className={INPUT_BASE}
            aria-label="选择对比班级 B"
          >
            <option value="">选择班级 B...</option>
            {activeClassList.map((c) => (
              <option key={c.id} value={c.class_id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {compareDataA && compareDataB && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
            {[compareDataA, compareDataB].map((d) => (
              <div
                key={d.className}
                className="bg-gray-50/80 dark:bg-white/[0.03] rounded-xl p-4 border border-gray-100 dark:border-white/[0.06]"
              >
                <h5 className="font-semibold text-sm mb-2">{d.className}</h5>
                <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <div className="flex justify-between">
                    <span>学生数</span>
                    <span className="font-mono">{d.studentCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>平均分</span>
                    <span className="font-mono">{d.avgScore.toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>高风险</span>
                    <span className={`font-mono ${d.highRisk > 0 ? 'text-red-500 font-bold' : ''}`}>
                      {d.highRisk}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>极高</span>
                    <span className="font-mono text-red-500">{d.riskDistribution.极高}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>高</span>
                    <span className="font-mono text-orange-500">{d.riskDistribution.高}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>中</span>
                    <span className="font-mono text-yellow-500">{d.riskDistribution.中}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>低</span>
                    <span className="font-mono text-green-500">{d.riskDistribution.低}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}
