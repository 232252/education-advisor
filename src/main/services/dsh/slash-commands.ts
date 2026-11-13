// =============================================================
// DSH 内置斜杠指令 — 主进程入口
// 目录与解析的单一来源在 @shared/slash-commands（渲染端菜单共用同一份）。
// 本文件仅重导出，保持主进程既有导入路径稳定。
// =============================================================

export {
  isSlashInput,
  matchSlashCommands,
  parseSlashInput,
  SLASH_COMMANDS,
  type SlashCommand,
} from '@shared/slash-commands'
