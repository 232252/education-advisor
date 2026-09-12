// =============================================================
// WebUI 选文件 — 浏览器 input + POST /upload,不走主机 openDialog
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const openDialog = vi.fn()

vi.mock('../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({ sys: { openDialog, saveDialog: vi.fn() } }),
}))

import { acceptFromFilters, pickFile, pickFiles } from '../../../src/renderer/lib/dialog'
import { setWebUiRuntime } from '../../../src/renderer/lib/runtime-env'

function mockFileInput(files: File[]) {
  const realCreate = document.createElement.bind(document)
  return vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = realCreate(tag)
    if (tag === 'input') {
      Object.defineProperty(el, 'click', {
        configurable: true,
        value: () => {
          Object.defineProperty(el, 'files', { configurable: true, value: files })
          el.dispatchEvent(new Event(files.length > 0 ? 'change' : 'cancel'))
        },
      })
    }
    return el
  })
}

beforeEach(() => {
  setWebUiRuntime(false)
  openDialog.mockReset()
  sessionStorage.clear()
})

afterEach(() => {
  setWebUiRuntime(false)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('acceptFromFilters', () => {
  it('扩展名转成 input accept;含 * 则不限制', () => {
    expect(acceptFromFilters([{ name: 'Excel', extensions: ['xlsx', 'xls'] }])).toBe('.xlsx,.xls')
    expect(acceptFromFilters([{ name: 'all', extensions: ['*'] }])).toBe('')
    expect(acceptFromFilters()).toBe('')
  })
})

describe('pickFiles 桌面', () => {
  it('走 sys.openDialog', async () => {
    openDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/a.txt'] })
    await expect(pickFiles({ filters: [] })).resolves.toEqual(['/tmp/a.txt'])
    expect(openDialog).toHaveBeenCalled()
  })
})

describe('pickFiles / pickFile WebUI', () => {
  it('用本机文件框并 POST /upload,不弹主机对话框', async () => {
    setWebUiRuntime(true)
    sessionStorage.setItem('ea-webui-k', 'tok-1')
    const file = new File(['hi'], 'notes.txt', { type: 'text/plain' })
    mockFileInput([file])
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, path: 'C:\\data\\webui-uploads\\notes.txt' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const paths = await pickFiles({
      filters: [{ name: 'text', extensions: ['txt', 'md'] }],
    })
    expect(paths).toEqual(['C:\\data\\webui-uploads\\notes.txt'])
    expect(openDialog).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/upload')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(file)
    expect((init.headers as Record<string, string>)['X-EA-Token']).toBe('tok-1')
    expect((init.headers as Record<string, string>)['X-Filename']).toBe(encodeURIComponent('notes.txt'))
  })

  it('取消选择 → 空数组 / null,不上传', async () => {
    setWebUiRuntime(true)
    mockFileInput([])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(pickFiles({})).resolves.toEqual([])
    await expect(pickFile({})).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(openDialog).not.toHaveBeenCalled()
  })
})
