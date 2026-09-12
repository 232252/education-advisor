// =============================================================
// channels/manifest — manifest 校验(纯函数)
// manifest 是连接中心 UI 的数据源,坏 manifest 会在注册期就炸出
// 空卡片/坏表单,这里在注册时前置校验并返回问题清单。
// =============================================================

import type { ChannelManifest, ConfigField } from '@shared/types'

const MANIFEST_ID_PATTERN = /^[a-z][a-z0-9-]*$/

/** 校验单个字段声明,返回问题列表(空数组 = 通过) */
function validateField(field: ConfigField, allNames: Set<string>): string[] {
  const problems: string[] = []
  const prefix = `configSchema[${field.name ?? '(missing)'}]`
  if (!field.name || typeof field.name !== 'string') {
    return [`${prefix}: name 缺失`]
  }
  if (!field.label) problems.push(`${prefix}: label 缺失`)
  if (field.type === 'select') {
    if (!field.options || field.options.length === 0) {
      problems.push(`${prefix}: select 字段必须提供非空 options`)
    } else {
      const values = new Set(field.options.map((o) => o.value))
      if (values.size !== field.options.length) {
        problems.push(`${prefix}: options 存在重复 value`)
      }
    }
  }
  if (field.type === 'secret' && field.default !== undefined) {
    problems.push(`${prefix}: secret 字段不允许 default(密钥不进 settings.json)`)
  }
  if (field.pattern !== undefined) {
    try {
      new RegExp(field.pattern)
    } catch {
      problems.push(`${prefix}: pattern 不是合法正则(${field.pattern})`)
    }
  }
  if (field.showIf) {
    if (!field.showIf.field || !allNames.has(field.showIf.field)) {
      problems.push(`${prefix}: showIf.field 引用了不存在的字段(${field.showIf.field})`)
    }
  }
  return problems
}

/** 校验 manifest 完整性,返回问题列表(空数组 = 通过,可注册) */
export function validateManifest(manifest: ChannelManifest): string[] {
  const problems: string[] = []
  if (!manifest.id || !MANIFEST_ID_PATTERN.test(manifest.id)) {
    problems.push(`id 非法(须 kebab-case 且以字母开头): ${manifest.id}`)
  }
  if (!manifest.label) problems.push('label 缺失')
  if (!manifest.description) problems.push('description 缺失')
  if (!manifest.icon) problems.push('icon 缺失')
  if (!manifest.capabilities) {
    problems.push('capabilities 缺失')
    return problems
  }
  const cap = manifest.capabilities as unknown as Record<string, unknown>
  const capKeys: Array<[string, unknown]> = [
    ['receivesVia', cap.receivesVia],
    ['streamingKind', cap.streamingKind],
    ['pushPolicy', cap.pushPolicy],
  ]
  for (const [key, value] of capKeys) {
    if (value === undefined || value === null || value === '') {
      problems.push(`capabilities.${key} 缺失`)
    }
  }
  if (!Array.isArray(manifest.configSchema)) {
    problems.push('configSchema 缺失或不是数组')
    return problems
  }
  const names = new Set(manifest.configSchema.map((f) => f.name))
  if (names.size !== manifest.configSchema.length) {
    problems.push('configSchema 存在重复 name')
  }
  for (const field of manifest.configSchema) {
    problems.push(...validateField(field, names))
  }
  if (manifest.setupGuide) {
    if (!manifest.setupGuide.title) problems.push('setupGuide.title 缺失')
    if (!Array.isArray(manifest.setupGuide.steps) || manifest.setupGuide.steps.length === 0) {
      problems.push('setupGuide.steps 缺失或为空')
    }
  }
  return problems
}
