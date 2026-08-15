// =============================================================
// ReasonDistCard — 事件原因码分布卡片
// 横向进度条列表展示 Top 8 原因码（含中文标签映射）
// =============================================================

import { ClipboardList } from 'lucide-react'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'

// 原因码 → 中文标签映射
const REASON_CODE_LABELS: Record<string, string> = {
  SPEAK_IN_CLASS: '课堂讲话',
  SLEEP_IN_CLASS: '课堂睡觉',
  LATE: '迟到',
  SCHOOL_CAUGHT: '学校抓拍违纪',
  MAKEUP: '补差扣分',
  DESK_UNALIGNED: '桌椅不整齐',
  PHONE_IN_CLASS: '手机违纪',
  SMOKING: '抽烟',
  DRINKING_DORM: '寝室饮酒',
  OTHER_DEDUCT: '其他扣分',
  APPEARANCE_VIOLATION: '仪容仪表违纪',
  BONUS_VARIABLE: '学业奖励(变量)',
  ACTIVITY_PARTICIPATION: '活动参与加分',
  CLASS_MONITOR: '班长履职加分',
  CLASS_COMMITTEE: '班委履职加分',
  CIVILIZED_DORM: '文明寝室',
  MONTHLY_ATTENDANCE: '月勤奖励',
  REVERT: '撤销(自动计算)',
  LAB_EQUIPMENT_DAMAGE: '实验室设备损坏',
  LAB_SAFETY_VIOLATION: '实验室安全违规',
  LAB_UNSAFE_BEHAVIOR: '实验室不安全行为',
  LAB_CLEAN_UP: '实验室未清理',
}

// 进度条渐变起止色（按序取用）
const BAR_FROM = [
  '#3b82f6',
  '#22c55e',
  '#eab308',
  '#a855f7',
  '#ef4444',
  '#06b6d4',
  '#f97316',
  '#ec4899',
]
const BAR_TO = [
  '#1d4ed8',
  '#15803d',
  '#a16207',
  '#7e22ce',
  '#b91c1c',
  '#0891b2',
  '#ea580c',
  '#db2777',
]

export function ReasonDistCard({ items }: { items: Array<{ code: string; count: number }> }) {
  const { t } = useT()
  return (
    <Card
      padding="md"
      className="shadow-card hover:shadow-card-hover transition-shadow duration-300"
    >
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
        {t('page.dashboard.chart.eventReason')}
      </h3>
      <div className="space-y-2">
        {items?.slice(0, 8).map((item, idx) => (
          <div key={item.code} className="flex items-center gap-2 text-xs group">
            <span
              className="text-gray-600 dark:text-gray-300 min-w-[5rem] truncate"
              title={item.code || ''}
            >
              {(REASON_CODE_LABELS[item.code || ''] ?? item.code) || '未知'}
            </span>
            <div className="flex-1 h-2 bg-gray-200 dark:bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 group-hover:opacity-80"
                style={{
                  width: `${Math.min(100, (item.count / (items[0]?.count ?? 1)) * 100)}%`,
                  background: `linear-gradient(90deg, ${BAR_FROM[idx]}, ${BAR_TO[idx]})`,
                }}
              />
            </div>
            <span className="text-gray-500 dark:text-gray-400 w-8 text-right font-mono flex-shrink-0">
              {item.count}
            </span>
          </div>
        )) ?? <EmptyState icon={<ClipboardList size={28} />} title="暂无数据" className="py-6" />}
      </div>
    </Card>
  )
}
