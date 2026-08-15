// =============================================================
// 新建/编辑任务表单 — Cron 表达式实时校验 + 预设选择
// =============================================================

import type { AgentListItem, CronTask } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../i18n'
import { CRON_PRESETS, validateCron } from '../../../lib/cron-utils'
import { btnStyle, cn, INPUT_BASE, INPUT_INVALID } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'

interface NewTaskFormProps {
  agents: AgentListItem[]
  /** 编辑模式:传入已有任务则填充表单,提交时调用 onUpdate */
  editingTask: CronTask | null
  onCreate: (task: Omit<CronTask, 'id'>) => void
  onUpdate: (id: string, patch: Partial<CronTask>) => void
  onCancel: () => void
}

export function NewTaskForm({
  agents,
  editingTask,
  onCreate,
  onUpdate,
  onCancel,
}: NewTaskFormProps) {
  const { t } = useT()
  const isEditing = editingTask !== null
  const [name, setName] = useState(editingTask?.name ?? '')
  const [agentId, setAgentId] = useState(editingTask?.agentId ?? agents[0]?.id ?? '')
  const [expression, setExpression] = useState(editingTask?.expression ?? '0 9 * * *')
  const [prompt, setPrompt] = useState(editingTask?.prompt ?? '')
  const [modelTier, setModelTier] = useState<'high_quality' | 'low_cost'>(
    editingTask?.modelTier ?? 'low_cost',
  )

  // LOW 修复: 切换 editingTask 时(从"编辑任务 A"切到"编辑任务 B",
  // 或在打开表单状态下从其他位置触发编辑)同步表单字段。
  // useState 初始化只在 mount 时执行一次,editingTask prop 变化不会自动同步,
  // 导致切到 B 后表单仍显示 A 的数据,提交时覆盖错任务。
  // 仅当 editingTask.id 实际变化时才同步,避免每次父组件重渲都重置用户输入。
  const lastEditingIdRef = useRef<string | null>(editingTask?.id ?? null)
  useEffect(() => {
    const currentId = editingTask?.id ?? null
    if (currentId === lastEditingIdRef.current) return
    lastEditingIdRef.current = currentId
    setName(editingTask?.name ?? '')
    setAgentId(editingTask?.agentId ?? agents[0]?.id ?? '')
    setExpression(editingTask?.expression ?? '0 9 * * *')
    setPrompt(editingTask?.prompt ?? '')
    setModelTier(editingTask?.modelTier ?? 'low_cost')
  }, [editingTask, agents])

  // LOW 修复: 编辑模式下,若 editingTask.agentId 不在 agents 列表中(已被删除),
  // 自动回退到第一个可用 agent 并提示用户,避免提交时使用无效 agentId。
  // 也覆盖 agents 列表异步加载完成后 agentId 仍指向已删除 agent 的场景。
  // biome-ignore lint/correctness/useExhaustiveDependencies: t is stable from useT()
  useEffect(() => {
    if (agents.length === 0) return
    if (agentId && agents.find((a) => a.id === agentId)) return
    // 当前 agentId 无效,回退到第一个可用 agent
    const fallback = agents[0]?.id ?? ''
    if (fallback && fallback !== agentId) {
      setAgentId(fallback)
      if (isEditing) {
        toast.warning(t('toast.scheduler.agentGone'))
      }
    }
  }, [agents, agentId, isEditing])

  // P0: cron 表达式实时校验 (前端基本格式校验, 提交前再次校验避免漏判)
  const cronValidation = validateCron(expression)
  const isCronValid = cronValidation.valid

  const presets = CRON_PRESETS

  const handleSubmit = () => {
    if (!name.trim() || !agentId || !expression.trim() || !prompt.trim()) return
    // 提交前再次校验, 防止绕过 disabled 的情况 (如直接触发)
    if (!isCronValid) {
      toast.error(`Cron 表达式无效: ${cronValidation.error ?? ''}`)
      return
    }
    if (isEditing && editingTask) {
      onUpdate(editingTask.id, {
        name: name.trim(),
        agentId,
        expression: expression.trim(),
        prompt: prompt.trim(),
        modelTier,
      })
    } else {
      onCreate({
        name: name.trim(),
        agentId,
        expression: expression.trim(),
        prompt: prompt.trim(),
        enabled: true,
        modelTier,
      })
    }
  }

  return (
    <div className="border-b border-gray-200 dark:border-white/[0.06] p-4 bg-gray-50 dark:bg-surface-tertiary">
      <h3 className="text-sm font-medium mb-3">{isEditing ? '编辑定时任务' : '新建定时任务'}</h3>

      <div className="grid grid-cols-2 gap-3">
        {/* 任务名称 */}
        <div>
          <label
            htmlFor="task-name"
            className="text-xs text-gray-400 dark:text-gray-500 block mb-1"
          >
            任务名称
          </label>
          <input
            id="task-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 每日巡检"
            className={cn('w-full', INPUT_BASE)}
          />
        </div>

        {/* Agent 选择 */}
        <div>
          <label
            htmlFor="task-agent"
            className="text-xs text-gray-400 dark:text-gray-500 block mb-1"
          >
            Agent
          </label>
          <select
            id="task-agent"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className={cn('w-full', INPUT_BASE)}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            {agents.length === 0 && <option value="">无可用 Agent</option>}
          </select>
        </div>

        {/* Cron 表达式 */}
        <div>
          <label
            htmlFor="task-cron"
            className="text-xs text-gray-400 dark:text-gray-500 block mb-1"
          >
            Cron 表达式
          </label>
          <input
            id="task-cron"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            placeholder="* * * * *"
            aria-invalid={!isCronValid}
            className={cn('w-full font-mono', isCronValid ? INPUT_BASE : INPUT_INVALID)}
          />
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {presets.map((p) => (
              <button
                type="button"
                key={p.value}
                onClick={() => setExpression(p.value)}
                className={`text-[10px] px-2 py-0.5 rounded-lg transition-colors
                  ${expression === p.value ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500 dark:bg-surface-elevated dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-white/[0.08]'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* 实时校验提示 */}
          <div
            className={`mt-1 text-[11px] leading-tight ${
              isCronValid ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
            }`}
            role={isCronValid ? 'status' : 'alert'}
          >
            {isCronValid ? '✓ 表达式有效' : `✗ ${cronValidation.error ?? '无效'}`}
          </div>
        </div>

        {/* 模型层级 */}
        <div>
          <span className="text-xs text-gray-400 dark:text-gray-500 block mb-1">模型</span>
          <div className="flex gap-2" role="radiogroup" aria-label="模型层级">
            <button
              type="button"
              role="radio"
              aria-checked={modelTier === 'low_cost'}
              onClick={() => setModelTier('low_cost')}
              className={`flex-1 text-sm py-1.5 rounded-lg transition-colors
                ${modelTier === 'low_cost' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500 dark:bg-surface-elevated dark:text-gray-400'}`}
            >
              低成本
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={modelTier === 'high_quality'}
              onClick={() => setModelTier('high_quality')}
              className={`flex-1 text-sm py-1.5 rounded-lg transition-colors
                ${modelTier === 'high_quality' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500 dark:bg-surface-elevated dark:text-gray-400'}`}
            >
              高质量
            </button>
          </div>
        </div>
      </div>

      {/* Prompt */}
      <div className="mt-3">
        <label
          htmlFor="task-prompt"
          className="text-xs text-gray-400 dark:text-gray-500 block mb-1"
        >
          执行指令
        </label>
        <textarea
          id="task-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Agent 每次执行时收到的指令..."
          rows={2}
          className={cn('w-full resize-none', INPUT_BASE)}
        />
      </div>

      {/* 按钮 */}
      <div className="flex justify-end gap-2 mt-3">
        <button type="button" onClick={onCancel} className={btnStyle('secondary')}>
          取消
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={
            !name.trim() || !agentId || !expression.trim() || !prompt.trim() || !isCronValid
          }
          className={btnStyle('primary')}
        >
          {isEditing ? '保存' : '创建'}
        </button>
      </div>
    </div>
  )
}
