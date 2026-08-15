// =============================================================
// 共享类型定义 -- 主进程和渲染进程共用
// 按域拆分至同目录各文件,此处统一 re-export,
// 保证 `from '@shared/types'` 的既有导入路径不变
// =============================================================

export type * from './academics'
export type * from './agent'
export type * from './ai'
export type * from './chat'
export type * from './class'
export type * from './common'
export type * from './cron'
export type * from './eaa'
export type * from './feishu'
export type * from './mcp'
export type * from './ollama'
export type * from './privacy'
export type * from './settings'
export type * from './skill'
