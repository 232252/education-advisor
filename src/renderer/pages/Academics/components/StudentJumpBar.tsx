// =============================================================
// StudentJumpBar — 学业总览顶部跳转：学生档案学业 / AI 分析
// =============================================================

import { BookOpen, Bot } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../../components/Button'
import { useT } from '../../../i18n'

export function StudentJumpBar({ entityId }: { entityId: string }) {
  const { t } = useT()
  const navigate = useNavigate()
  const encoded = encodeURIComponent(entityId)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        icon={<BookOpen size={14} />}
        onClick={() => navigate(`/students?entity_id=${encoded}&tab=academics`)}
      >
        {t('page.academics.jump.profileAcademics')}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        icon={<Bot size={14} />}
        onClick={() => navigate(`/students?entity_id=${encoded}&tab=ai`)}
      >
        {t('page.academics.jump.ai')}
      </Button>
    </div>
  )
}
