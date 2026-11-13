// =============================================================
// 推理档位表守卫：教师端 THINKING_LEVELS 必须与真实安装的
// dsh-llm-pi-ai 枚举一致（含顺序）。
//
// dsh 用该枚举校验 profile 的 reasoningEfforts 键与 initialize 的档位；
// 官方增删档位而教师端没跟上，表现为整轮「does not support reasoning
// effort」或新档位永远选不到。升级时这里变红 → 同步表，而不是静默漂移。
// =============================================================

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THINKING_LEVELS } from '@shared/thinking-levels'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))

/** 从真实安装的 dsh-llm-pi-ai 提取 THINKING_LEVELS 枚举（Object.keys 字面量）。 */
function installedThinkingLevels(): string[] {
  const req = createRequire(join(ROOT, 'package.json'))
  const entry = req.resolve('@deepseek-ai/dsh-llm-pi-ai')
  const source = readFileSync(entry, 'utf8')
  const match = /const THINKING_LEVELS = Object\.keys\(\{([\s\S]*?)\}\)/.exec(source)
  if (!match) throw new Error('dsh-llm-pi-ai 里找不到 THINKING_LEVELS 定义（官方结构变了？）')
  const keys = [...match[1].matchAll(/^\s*([A-Za-z]+)\s*:/gm)].map((m) => m[1])
  if (!keys.length) throw new Error('THINKING_LEVELS 解析为空')
  return keys
}

describe('推理档位表与真实 DSH 一致', () => {
  it('档位与顺序逐项一致', () => {
    expect([...THINKING_LEVELS]).toEqual(installedThinkingLevels())
  })
})
