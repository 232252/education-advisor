import type { McpServerConfig, McpTransport } from '@shared/types'
import { cloneElement, useId, useMemo, useState } from 'react'
import { useT } from '../../../i18n'
import { CARD_BASE, cn, INPUT_SM } from '../../../lib/ui-utils'
import { validateMcpConfig } from '../mcp-validate'

interface McpServerFormProps {
  initial: Partial<McpServerConfig> | null
  /**
   * 表单模式(R3-2 / UI-R8 修复):
   *   - 'add'   新增(含从模板添加):标题"新增",id 可编辑
   *   - 'edit'  编辑现有 server:标题"编辑",id 只读
   * 旧实现用 !!initial 判断模式,导致"从模板添加"(presetDraft 非空)被误判为编辑,
   * id 被禁用、标题显示"编辑"。显式 mode 消除歧义。
   */
  mode?: 'add' | 'edit'
  onSubmit: (config: McpServerConfig) => Promise<void> | void
  onCancel: () => void
}

/**
 * 表单草稿状态:args/env/headers 以字符串形式存放(textarea 编辑),
 * 提交时再通过 parseArgs/parseKv 转回 McpServerConfig 期望的类型。
 */
interface DraftState {
  id: string
  name: string
  description: string
  enabled: boolean
  transport: McpTransport
  command: string
  args: string
  env: string
  url: string
  headers: string
}

/** 把 Partial<McpServerConfig> 规整成可编辑的 DraftState(数组/对象 → 字符串) */
function toDraft(initial: Partial<McpServerConfig> | null): DraftState {
  return {
    id: initial?.id ?? '',
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    enabled: initial?.enabled ?? true,
    transport: (initial?.transport as McpTransport) ?? 'stdio',
    command: initial?.command ?? '',
    args: Array.isArray(initial?.args) ? initial?.args?.join('\n') : '',
    env: initial?.env ? stringifyKv(initial.env, '=') : '',
    url: initial?.url ?? '',
    headers: initial?.headers ? stringifyKv(initial.headers, ': ') : '',
  }
}

export function McpServerForm({ initial, mode, onSubmit, onCancel }: McpServerFormProps) {
  const { t } = useT()
  const [draft, setDraft] = useState<DraftState>(() => toDraft(initial))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const titleId = useId()
  // R3-2: 显式模式优先;未传则回退到旧的 !!initial 推断(向后兼容)
  const isEdit = mode ? mode === 'edit' : !!initial

  // validateMcpConfig 入参为 Partial<McpServerConfig>;draft 字段已是合法子集
  const draftAsConfig = useMemo<Partial<McpServerConfig>>(
    () => ({
      id: draft.id,
      name: draft.name,
      description: draft.description,
      enabled: draft.enabled,
      transport: draft.transport,
      command: draft.command,
      url: draft.url,
    }),
    [draft],
  )

  const update = (patch: Partial<DraftState>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
    if (submitted) {
      // 校验只关心标量字段(args/env/headers 是字符串形式,validator 不读取)
      const next: Partial<McpServerConfig> = {
        id: patch.id ?? draft.id,
        name: patch.name ?? draft.name,
        description: patch.description ?? draft.description,
        enabled: patch.enabled ?? draft.enabled,
        transport: patch.transport ?? draft.transport,
        command: patch.command ?? draft.command,
        url: patch.url ?? draft.url,
      }
      setErrors(validateMcpConfig(next))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitted(true)
    const errs = validateMcpConfig(draftAsConfig)
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    // 把字符串形式的 args/env/headers 解析回数组/对象
    const config: McpServerConfig = {
      id: draft.id.trim(),
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      enabled: draft.enabled,
      transport: draft.transport,
      ...(draft.transport === 'stdio'
        ? {
            command: draft.command.trim(),
            args: parseArgs(draft.args),
            env: parseKv(draft.env),
          }
        : {
            url: draft.url.trim(),
            headers: parseKv(draft.headers),
          }),
    }
    setSubmitting(true)
    try {
      await onSubmit(config)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className={`${CARD_BASE} p-6 w-full max-w-lg max-h-[90vh] overflow-auto`}
      >
        <h2 id={titleId} className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">
          {isEdit ? t('page.mcp.edit') : t('page.mcp.add')}
        </h2>

        <div className="space-y-3">
          <FormField
            label={t('page.mcp.field.id')}
            error={errors.id ? t(errors.id) : undefined}
            required
          >
            <input
              type="text"
              value={draft.id}
              onChange={(e) => update({ id: e.target.value })}
              disabled={isEdit}
              className={cn('w-full', INPUT_SM, 'disabled:opacity-50')}
            />
          </FormField>

          <FormField
            label={t('page.mcp.field.name')}
            error={errors.name ? t(errors.name) : undefined}
            required
          >
            <input
              type="text"
              value={draft.name}
              onChange={(e) => update({ name: e.target.value })}
              className={cn('w-full', INPUT_SM)}
            />
          </FormField>

          <FormField label={t('page.mcp.field.description')}>
            <input
              type="text"
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
              className={cn('w-full', INPUT_SM)}
            />
          </FormField>

          <FormField label={t('page.mcp.field.transport')} required>
            <select
              value={draft.transport}
              onChange={(e) => update({ transport: e.target.value as McpTransport })}
              className={cn('w-full', INPUT_SM)}
            >
              <option value="stdio">{t('page.mcp.transport.stdio')}</option>
              <option value="sse">{t('page.mcp.transport.sse')}</option>
              <option value="websocket">{t('page.mcp.transport.websocket')}</option>
            </select>
          </FormField>

          {draft.transport === 'stdio' ? (
            <>
              <FormField
                label={t('page.mcp.field.command')}
                error={errors.command ? t(errors.command) : undefined}
                required
              >
                <input
                  type="text"
                  value={draft.command}
                  onChange={(e) => update({ command: e.target.value })}
                  placeholder="npx"
                  className={cn('w-full font-mono', INPUT_SM)}
                />
              </FormField>
              <FormField label={t('page.mcp.field.args')} hint={t('page.mcp.hint.args')}>
                <textarea
                  value={draft.args}
                  onChange={(e) => update({ args: e.target.value })}
                  placeholder={'-y\n@modelcontextprotocol/server-filesystem'}
                  rows={2}
                  className={cn('w-full font-mono text-sm', INPUT_SM)}
                />
              </FormField>
              <FormField label={t('page.mcp.field.env')} hint={t('page.mcp.hint.env')}>
                <textarea
                  value={draft.env}
                  onChange={(e) => update({ env: e.target.value })}
                  // biome-ignore lint/suspicious/noTemplateCurlyInString: 占位符由后端 deepInterpolate 处理
                  placeholder={'USER_DOCS=${env.USERPROFILE}/Documents'}
                  rows={2}
                  className={cn('w-full font-mono text-sm', INPUT_SM)}
                />
              </FormField>
            </>
          ) : (
            <>
              <FormField
                label={t('page.mcp.field.url')}
                error={errors.url ? t(errors.url) : undefined}
                required
              >
                <input
                  type="text"
                  value={draft.url}
                  onChange={(e) => update({ url: e.target.value })}
                  placeholder="https://example.com/sse"
                  className={cn('w-full font-mono', INPUT_SM)}
                />
              </FormField>
              <FormField label={t('page.mcp.field.headers')} hint={t('page.mcp.hint.headers')}>
                <textarea
                  value={draft.headers}
                  onChange={(e) => update({ headers: e.target.value })}
                  placeholder={'Authorization: Bearer xxx'}
                  rows={2}
                  className={cn('w-full font-mono text-sm', INPUT_SM)}
                />
              </FormField>
            </>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            {t('page.mcp.field.enabled')}
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-1.5 text-sm rounded border border-gray-300 dark:border-white/[0.08] hover:bg-gray-100 dark:hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('common.confirm')}
          </button>
        </div>
      </form>
    </div>
  )
}

function FormField({
  label,
  error,
  required,
  hint,
  children,
}: {
  label: string
  error?: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  const fieldId = useId()
  const errorId = `${fieldId}-err`
  const hintId = `${fieldId}-hint`
  // children 约定是单个 input/select/textarea;用 cloneElement 注入 id 和 aria-* 关联
  const child = cloneElement(children as React.ReactElement, {
    id: fieldId,
    'aria-invalid': error ? true : undefined,
    'aria-describedby':
      [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined,
  })
  return (
    <div>
      <label
        htmlFor={fieldId}
        className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
      >
        {label}
        {required && (
          <span className="text-red-500 ml-0.5" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {child}
      {hint && (
        <p id={hintId} className="mt-0.5 text-xs text-gray-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-0.5 text-xs text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** 把多行字符串解析为 args 数组(每行一个 arg,或空格分隔) */
function parseArgs(input?: string): string[] {
  if (!input?.trim()) return []
  return input
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .flatMap((l) => (l.includes(' ') && !l.startsWith('"') ? l.split(/\s+/) : [l]))
}

/** 把 KEY=VALUE 或 KEY: VALUE 多行解析为对象 */
function parseKv(input?: string): Record<string, string> | undefined {
  if (!input?.trim()) return undefined
  const result: Record<string, string> = {}
  for (const line of input.split(/\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(trimmed.includes('=') ? '=' : ':')
    if (idx < 0) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (key) result[key] = value
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** 把 Record<string,string> 序列化为多行 KEY<sep>VALUE(env 用 '=',headers 用 ': ') */
function stringifyKv(kv: Record<string, string>, sep: string): string {
  return Object.entries(kv)
    .map(([k, v]) => `${k}${sep}${v}`)
    .join('\n')
}
