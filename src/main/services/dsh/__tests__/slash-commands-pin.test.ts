// =============================================================
// 斜杠指令清单守卫：教师端 SLASH_COMMANDS 必须与真实安装的
// dsh-commands builtinCommandTokens 一致（英文名 + 中文拼写 + 顺序）。
//
// DSH SDK 没有列举指令的 wire 方法，教师端用静态清单做菜单。官方增删
// 内置指令或改拼写而教师端没跟上，表现为菜单点了无效指令 / 新指令永远
// 选不到。升级时这里变红 → 同步清单，而不是静默漂移（DSH_CORE_RUNTIME.md §4.3）。
// =============================================================

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SLASH_COMMANDS } from '@shared/slash-commands'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))

/** 从真实安装的 dsh-commands 提取 builtinCommandTokens 的 en/zh 映射。 */
function installedTokens(): { en: Record<string, string>; zh: Record<string, string> } {
  const req = createRequire(join(ROOT, 'package.json'))
  const entry = req.resolve('@deepseek-ai/dsh-commands/builtin')
  const source = readFileSync(entry, 'utf8')
  const parse = (lang: 'en' | 'zh'): Record<string, string> => {
    const m = new RegExp(`${lang}:\\s*\\{([\\s\\S]*?)\\}`).exec(source)
    if (!m) throw new Error(`dsh-commands 里找不到 builtinCommandTokens.${lang}（官方结构变了？）`)
    const out: Record<string, string> = {}
    for (const pair of m[1].matchAll(/([A-Za-z]+):\s*'([^']*)'/g)) out[pair[1]] = pair[2]
    if (!Object.keys(out).length) throw new Error(`builtinCommandTokens.${lang} 解析为空`)
    return out
  }
  return { en: parse('en'), zh: parse('zh') }
}

describe('斜杠指令清单与真实 DSH 一致', () => {
  it('英文名与顺序逐项一致', () => {
    const { en } = installedTokens()
    expect(SLASH_COMMANDS.map((c) => c.name)).toEqual(Object.values(en))
  })

  it('中文拼写逐项一致', () => {
    const { en, zh } = installedTokens()
    const byName = new Map(SLASH_COMMANDS.map((c) => [c.name, c.zh]))
    for (const key of Object.keys(en)) {
      expect(byName.get(en[key])).toBe(zh[key])
    }
  })
})
