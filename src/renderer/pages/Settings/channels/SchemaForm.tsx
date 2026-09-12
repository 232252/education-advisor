// =============================================================
// SchemaForm — manifest.configSchema 驱动的渠道配置表单(M5 连接中心)
// LangBot manifest 模式的 TS 版:字段类型 → 现有设置行组件映射,
// showIf 条件显隐;secret 走 '__keystore__' 占位符协议(keystore 加密存储)。
// 新渠道(钉钉等)零新增表单代码 — 只在各自 manifest 里声明字段。
// =============================================================

import type { ConfigField } from '@shared/types'
import { type ReactNode, useState } from 'react'
import { useT } from '../../../i18n'
import { cn, INPUT_INVALID, INPUT_SM } from '../../../lib/ui-utils'
import { SecretInput, SettingRow, ToggleSwitch } from '../components'

interface SchemaFormProps {
  /** 渠道设置路径前缀,如 'channels.feishu' */
  basePath: string
  fields: ConfigField[]
  /** 当前设置值(secret 字段为 '' 或 '__keystore__' 占位符) */
  values: Record<string, unknown>
  onSave: (path: string, value: unknown) => void
}

function fieldVisible(field: ConfigField, values: Record<string, unknown>): boolean {
  if (!field.showIf) return true
  return values[field.showIf.field] === field.showIf.equals
}

export function SchemaForm({ basePath, fields, values, onSave }: SchemaFormProps) {
  const { t } = useT()
  // select 的受控值:设置值缺省时显示 default(不写回,保存动作仍由用户触发)
  const [draft, setDraft] = useState<Record<string, string>>({})

  const renderControl = (field: ConfigField): ReactNode => {
    const path = `${basePath}.${field.name}`
    const value = values[field.name]
    switch (field.type) {
      case 'secret':
        return <SecretInput value={String(value ?? '')} onChange={(v) => onSave(path, v)} />
      case 'select': {
        const current = draft[field.name] ?? (typeof value === 'string' && value ? value : '')
        return (
          <select
            value={current}
            onChange={(e) => {
              setDraft((d) => ({ ...d, [field.name]: e.target.value }))
              onSave(path, e.target.value)
            }}
            className={cn(INPUT_SM, 'w-48')}
          >
            {!current && (
              <option value="">{t('settings.channels.form.selectPlaceholder', '请选择')}</option>
            )}
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )
      }
      case 'boolean':
        return (
          <ToggleSwitch
            checked={typeof value === 'boolean' ? value : field.default === true}
            onChange={(v) => onSave(path, v)}
            label={field.label}
          />
        )
      case 'number': {
        const num = typeof value === 'number' ? value : Number(field.default ?? 0)
        return (
          <input
            type="number"
            value={num}
            onChange={(e) => onSave(path, Number(e.target.value))}
            className={cn(INPUT_SM, 'w-32')}
          />
        )
      }
      default: {
        // string: pattern 校验红框(如飞书 appId ^cli_…)
        const str = typeof value === 'string' ? value : String(value ?? '')
        const invalid = field.pattern
          ? str.length > 0 && !new RegExp(field.pattern).test(str)
          : false
        return (
          <div className="flex flex-col items-end gap-1">
            <input
              type="text"
              value={str}
              placeholder={field.required ? `${field.label}` : ''}
              onChange={(e) => onSave(path, e.target.value)}
              className={cn(INPUT_SM, 'w-48', invalid && INPUT_INVALID)}
            />
            {field.helpLink && (
              <a
                href={field.helpLink}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-blue-500 dark:text-blue-400 hover:underline"
              >
                {t('settings.channels.form.helpLink', '字段说明 ↗')}
              </a>
            )}
          </div>
        )
      }
    }
  }

  return (
    <>
      {fields
        .filter((f) => fieldVisible(f, values))
        .map((field) => (
          <SettingRow
            key={field.name}
            label={field.label}
            path={`${basePath}.${field.name}`}
            description={field.description}
          >
            {renderControl(field)}
          </SettingRow>
        ))}
    </>
  )
}
