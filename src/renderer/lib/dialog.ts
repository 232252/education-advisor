// =============================================================
// dialog — 系统文件对话框包装
//
// 收口各 hook 手写的「await sys.openDialog/saveDialog → as 强转 →
// canceled/filePath 守卫」样板:返回选中的路径,取消/无效时返回 null。
// =============================================================

import { getAPI } from './ipc-client'

interface FileDialogFilter {
  name: string
  extensions: string[]
}

interface OpenFileDialogOptions {
  title?: string
  filters?: FileDialogFilter[]
  properties?: string[]
}

interface SaveFileDialogOptions {
  title?: string
  defaultPath?: string
  filters?: FileDialogFilter[]
}

/** 打开「选择文件」对话框,返回所选路径;取消或未选返回 null */
export async function pickFile(opts: OpenFileDialogOptions): Promise<string | null> {
  const result = (await getAPI().sys.openDialog(opts)) as
    | { canceled: boolean; filePaths?: string[] }
    | undefined
  if (!result || result.canceled || !result.filePaths?.length) return null
  return result.filePaths[0]
}

/** 打开「多选文件」对话框,返回全部所选路径;取消返回空数组 */
export async function pickFiles(opts: OpenFileDialogOptions): Promise<string[]> {
  const result = (await getAPI().sys.openDialog({
    ...opts,
    properties: [...(opts.properties ?? []), 'openFile', 'multiSelections'],
  })) as { canceled: boolean; filePaths?: string[] } | undefined
  if (!result || result.canceled || !result.filePaths?.length) return []
  return result.filePaths
}

/** 打开「保存文件」对话框,返回目标路径;取消或未填返回 null */
export async function saveAs(opts: SaveFileDialogOptions): Promise<string | null> {
  const result = (await getAPI().sys.saveDialog(opts)) as
    | { canceled: boolean; filePath?: string }
    | undefined
  if (!result || result.canceled || !result.filePath) return null
  return result.filePath
}
