// =============================================================
// dialog — 系统文件对话框包装
//
// 桌面: sys.openDialog / saveDialog。
// 浏览器 WebUI: 本机 <input type="file"> 选出文件后 POST /upload 落到
// 主机暂存目录,返回主机绝对路径(Agent 的 read_excel / 批改工具需要路径)。
// 不能走 Electron showOpenDialog — 那会在跑应用的电脑上弹框,手机选不到。
// =============================================================

import { getAPI } from './ipc-client'
import { isWebUiRuntime, readWebUiToken } from './runtime-env'

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

export function acceptFromFilters(filters?: FileDialogFilter[]): string {
  if (!filters?.length) return ''
  const exts = filters.flatMap((f) => f.extensions)
  if (exts.includes('*')) return ''
  return exts
    .filter((e) => e && e !== '*')
    .map((e) => (e.startsWith('.') ? e : `.${e}`))
    .join(',')
}

function pickBrowserFiles(opts: { multiple: boolean; accept: string }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = opts.multiple
    if (opts.accept) input.accept = opts.accept
    input.style.display = 'none'
    let settled = false
    const finish = (files: File[]) => {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(files)
    }
    const onFocus = () => {
      window.setTimeout(() => {
        if (!settled) finish(Array.from(input.files ?? []))
      }, 800)
    }
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])))
    input.addEventListener('cancel', () => finish([]))
    document.body.appendChild(input)
    input.click()
    window.addEventListener('focus', onFocus)
  })
}

async function uploadBrowserFile(file: File): Promise<string> {
  const token = readWebUiToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'X-Filename': encodeURIComponent(file.name),
  }
  if (token) headers['X-EA-Token'] = token
  const res = await fetch('/upload', {
    method: 'POST',
    headers,
    body: file,
    credentials: 'include',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `upload failed: ${res.status}`)
  }
  const data = (await res.json()) as { success?: boolean; path?: string; error?: string }
  if (!data.success || !data.path) {
    throw new Error(data.error || 'upload failed')
  }
  return data.path
}

async function pickViaBrowser(multiple: boolean, filters?: FileDialogFilter[]): Promise<string[]> {
  const files = await pickBrowserFiles({
    multiple,
    accept: acceptFromFilters(filters),
  })
  if (files.length === 0) return []
  const paths: string[] = []
  for (const file of files) {
    paths.push(await uploadBrowserFile(file))
  }
  return paths
}

/** 打开「选择文件」对话框,返回所选路径;取消或未选返回 null */
export async function pickFile(opts: OpenFileDialogOptions): Promise<string | null> {
  if (isWebUiRuntime()) {
    const paths = await pickViaBrowser(false, opts.filters)
    return paths[0] ?? null
  }
  const result = (await getAPI().sys.openDialog(opts)) as
    | { canceled: boolean; filePaths?: string[] }
    | undefined
  if (!result || result.canceled || !result.filePaths?.length) return null
  return result.filePaths[0]
}

/** 打开「多选文件」对话框,返回全部所选路径;取消返回空数组 */
export async function pickFiles(opts: OpenFileDialogOptions): Promise<string[]> {
  if (isWebUiRuntime()) {
    return pickViaBrowser(true, opts.filters)
  }
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
