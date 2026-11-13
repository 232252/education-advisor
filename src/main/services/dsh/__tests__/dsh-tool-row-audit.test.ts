// =============================================================
// 官方工具行清单守卫（DSH_CORE_RUNTIME.md §4.3 门禁）
//
// 加固清单是硬编码的；DSH 小升级若新增「模型可见工具行」而清单没跟上，
// 教师机就会暴露新能力（shell/写文件/联网等）。本测试对照真实安装的
// dsh-base / dsh-sdk-app 补丁：每一个模型可见工具行必须么被加固清单关闭，
// 要么在显式保留名单里。官方新增一行 → 这里变红 → 补名单，而不是静默放行。
// =============================================================

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse, type ScalarTag } from 'yaml'
import { EAA_DISABLED_DSH_ROWS, EAA_REVIEWED_TOOL_ROWS, EAA_TOOL_INFRA_ROWS } from '../hardening'

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))

// 与 hardening.readInstalledRowConfig 相同的 !!js 标签处理，避免解析告警
const JS_TAG: ScalarTag = {
  identify: (v: unknown) =>
    Boolean(v && typeof v === 'object' && v !== null && Object.hasOwn(v, '__js')),
  tag: 'tag:yaml.org,2002:js',
  resolve: (value: string) => ({ __js: String(value) }),
}

interface PatchRow {
  id?: unknown
  name?: unknown
  insert?: unknown
}

/** 收集一个官方包补丁里所有「模型可见工具行」的 id（name 以 dsh-tool- 开头）。 */
function modelVisibleToolRows(packageName: string): string[] {
  const req = createRequire(join(ROOT, 'package.json'))
  const manifestPath = req.resolve(`${packageName}/package.json`)
  const patchPath = join(dirname(manifestPath), 'cordis.patch.yml')
  if (!existsSync(patchPath)) return []
  const rows = parse(readFileSync(patchPath, 'utf8'), {
    customTags: [JS_TAG],
    version: '1.1',
  }) as unknown
  const ids: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (!node || typeof node !== 'object') return
    const rec = node as PatchRow
    if (
      typeof rec.id === 'string' &&
      typeof rec.name === 'string' &&
      rec.name.startsWith('@deepseek-ai/dsh-tool-')
    ) {
      ids.push(rec.id)
    }
    if (rec.insert) walk(rec.insert)
  }
  walk(rows)
  return ids
}

describe('官方工具行清单守卫', () => {
  it('真实安装的每个模型可见工具行都已关闭或显式保留', () => {
    const installed = [
      ...modelVisibleToolRows('@deepseek-ai/dsh-base'),
      ...modelVisibleToolRows('@deepseek-ai/dsh-sdk-app'),
    ]
    // 没装官方包时不空转：至少应解析出已知的工具行
    expect(installed.length).toBeGreaterThan(0)
    const accounted = new Set<string>([
      ...EAA_DISABLED_DSH_ROWS,
      ...EAA_REVIEWED_TOOL_ROWS,
      ...EAA_TOOL_INFRA_ROWS,
    ])
    const unaccounted = [...new Set(installed)].filter((id) => !accounted.has(id))
    expect(unaccounted).toEqual([])
  })

  it('关闭 / 保留 / 基础设施三类名单互不重叠', () => {
    const all = [...EAA_DISABLED_DSH_ROWS, ...EAA_REVIEWED_TOOL_ROWS, ...EAA_TOOL_INFRA_ROWS]
    expect(new Set(all).size).toBe(all.length)
  })

  it('MCP 桥依赖的执行器不在关闭清单里（关了教育工具也调不起来）', () => {
    expect(EAA_DISABLED_DSH_ROWS).not.toContain('tool-executor-native')
    expect(EAA_TOOL_INFRA_ROWS).toContain('tool-executor-native')
  })
})
