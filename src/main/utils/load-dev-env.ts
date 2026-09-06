// =============================================================
// 开发模式 .env 加载器
// 此前主进程不解析 .env — .env.example 里的 DEBUG_*/ENABLE_CDP 等
// 注释暗示"拷贝 .env 即可调试",但实际必须手动 export 才生效。
// 本加载器在开发模式(!app.isPackaged)下把项目根 .env 的 KEY=VALUE
// 注入 process.env(已存在的环境变量不覆盖),让文档承诺成立。
// 生产模式不加载(打包应用的环境来自安装环境,不应读源码目录)。
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { errText } from './err-text'

/** 解析 .env 文本 → 条目数组(跳过注释/空行;不支持引号剥离以外的 shell 语法) */
export function parseEnvContent(content: string): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = []
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    // 去掉成对引号
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    entries.push({ key, value })
  }
  return entries
}

/**
 * 开发模式下加载项目根 .env 到 process.env(不覆盖已有值)。
 * 返回加载的条目数,供启动日志输出。
 */
export function loadDevEnv(): number {
  if (app.isPackaged) return 0
  const envPath = path.join(__dirname, '..', '..', '.env')
  try {
    if (!fs.existsSync(envPath)) return 0
    const entries = parseEnvContent(fs.readFileSync(envPath, 'utf-8'))
    let loaded = 0
    for (const { key, value } of entries) {
      if (process.env[key] === undefined) {
        process.env[key] = value
        loaded++
      }
    }
    return loaded
  } catch (err) {
    console.warn('[loadDevEnv] failed to load .env:', errText(err))
    return 0
  }
}
