// =============================================================
// read_image 工具：BMP 统一重编码为 JPEG
// 动机：BMP 未压缩最费 token，且它是 dsh 后端唯一不受理的受支持扩展名
// （dsh 只认 png/jpeg/webp/gif）——不转就出现 pi 能看、dsh 看不见的图。
// =============================================================

import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ calls: [] as Array<{ mime: string }> }))

vi.mock('../../src/main/services/grading/media-prep', () => ({
  downscaleToAiJpeg: async (buf: Buffer, mime: string) => {
    state.calls.push({ mime })
    return { data: buf.toString('base64'), mimeType: 'image/jpeg' }
  },
}))

const BMP_HEADER = Buffer.from([0x42, 0x4d, 0x1a, 0x00, 0x00, 0x00, 0x00, 0x00])
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

let dir = ''

beforeEach(async () => {
  state.calls = []
  dir = await mkdtemp(join(tmpdir(), 'eaa-image-tool-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function runOn(file: string, buf: Buffer) {
  const { readImageTool } = await import('../../src/main/services/files/image-tools')
  const abs = join(dir, file)
  await writeFile(abs, buf)
  expect(existsSync(abs)).toBe(true)
  return readImageTool.execute('t1', { path: abs }, undefined as never, undefined as never)
}

describe('read_image', () => {
  it('bmp → 重编码成 jpeg 后再交给模型（两种后端形状一致）', async () => {
    const out = await runOn('paper.bmp', BMP_HEADER)
    expect(state.calls).toEqual([{ mime: 'image/bmp' }])
    const image = out.content.find((c: { type: string }) => c.type === 'image')
    expect(image).toMatchObject({ mimeType: 'image/jpeg' })
    expect(String(out.content[0].text)).toContain('image/jpeg')
  })

  it('png 原样透传，不必过一遍画布', async () => {
    const out = await runOn('paper.png', PNG_HEADER)
    expect(state.calls).toEqual([])
    const image = out.content.find((c: { type: string }) => c.type === 'image')
    expect(image).toMatchObject({ mimeType: 'image/png', data: PNG_HEADER.toString('base64') })
    expect(readFileSync(join(dir, 'paper.png')).length).toBe(PNG_HEADER.length)
  })
})
