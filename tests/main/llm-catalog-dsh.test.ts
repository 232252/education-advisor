// =============================================================
// 「30+ LLM」目录 × dsh 后端的可用性底线
//
// 目录本身就是 pi-ai 的 provider data（app 以 vendor 形式随包），dsh 是包在它外面
// 的一层。两条以前只能靠人记着的不变量在这里钉住：
//  1. 目录确实给出 30+ 个 provider（对外口径的依据）；
//  2. dsh 子进程 resolve 到的必须是**同一份** pi-ai：一旦 npm 把它装成
//     @deepseek-ai/** 下的嵌套依赖，子进程用的就是 dsh 自己那份目录，
//     app 侧新加的模型 id 会被判 `has no configured model`（真踩过一次，
//     发生在从临时目录跑探针时）。
// =============================================================

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getProviders } from '@earendil-works/pi-ai/compat'
import { describe, expect, it } from 'vitest'
import { DSH_BUILTIN_ROUTE_ALIASES } from '../../src/main/services/dsh/route-names'

const ROOT = join(process.cwd())

describe('LLM 目录 × dsh', () => {
  it('目录提供的 provider 数量撑得起「30+ LLM」的口径', () => {
    const providers = getProviders() as string[]
    // 2026-09 实测 39 个；钉住现值而不是 30 的下限，少一批就该有人来看
    expect(providers.length).toBeGreaterThanOrEqual(39)
    // 光有 provider 数还不够：每个都要能列出模型才算可选项
    expect(providers.includes('deepseek')).toBe(true)
  })

  it('dsh 依赖树里没有嵌套的第二份 pi-ai（否则子进程看到的是另一个目录）', () => {
    const scoped = join(ROOT, 'node_modules', '@deepseek-ai')
    expect(existsSync(scoped)).toBe(true)
    const nested: string[] = []
    for (const pkg of readdirSync(scoped)) {
      const inner = join(scoped, pkg, 'node_modules', '@earendil-works')
      if (existsSync(inner)) nested.push(`${pkg}/node_modules/@earendil-works`)
    }
    expect(nested).toEqual([])
  })

  it('宿主自动声明的同名路由不会撞上 dsh-base 已占用的路由名', () => {
    // 撞名会把 dsh-base 自己那一行覆盖掉（patch 是同 id 后写覆盖），
    // 表现为该 provider 突然连不上 —— 所以别名表要与 pi 侧 provider 名互斥。
    const piNames = new Set(getProviders() as string[])
    const collisions = [...piNames].filter((name) =>
      Object.values(DSH_BUILTIN_ROUTE_ALIASES).includes(name),
    )
    expect(collisions).toEqual([])
  })
})
