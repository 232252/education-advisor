// =============================================================
// scripts/lib/gate-utils — 门禁脚本共享工具
// (doc-stats / ipc-contract-test / prompt-lint / prebuild-check
//  此前各自手写的 ROOT 解析、目录 walker、注释剥离、IPC 通道枚举
//  收敛于此 — 改导出风格/目录约定只需改这里)
// =============================================================
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根(scripts/lib/ 的上两级) */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 递归收集目录下满足 fileFilter 的文件绝对路径。
 * skipDirs 按目录名整棵跳过(默认 node_modules)。
 * 目录不存在返回 []。
 */
export function walkFiles(dir, fileFilter, skipDirs = ['node_modules']) {
  const out = []
  const walk = (d) => {
    if (!existsSync(d) || !statSync(d).isDirectory()) return
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) {
        if (!skipDirs.includes(name)) walk(p)
      } else if (fileFilter(p)) {
        out.push(p)
      }
    }
  }
  walk(dir)
  return out
}

/** 读仓库内相对路径文件 */
export const readRepo = (rel) => readFileSync(join(ROOT, rel), 'utf-8')

/** 去掉块注释与行注释(避免把注释中的符号误计入门禁集合) */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/**
 * src/shared/ipc-channels.ts 导出的通道常量名集合。
 * 唯一权威正则(doc-stats 计数与 ipc-contract 集合共用 —
 * 此前两份正则已出现 = 号要求的漂移)。
 */
export function parseIpcChannelConstants() {
  const src = stripComments(readRepo('src/shared/ipc-channels.ts'))
  const set = new Set()
  const re = /^export const (IPC_[A-Z0-9_]+)\s*=/gm
  let m
  while ((m = re.exec(src)) !== null) set.add(m[1])
  return set
}
