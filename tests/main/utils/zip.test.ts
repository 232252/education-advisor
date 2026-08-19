// =============================================================
// zip 工具测试 — 打包/解包 round-trip / 条目名安全校验 / 损坏包拒绝
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createZip, isSafeEntryName, readZipBuffer, readZipFile } from '../../../src/main/utils/zip'

describe('isSafeEntryName', () => {
  it.each([
    ['settings.json', true],
    ['eaa-data/entities/entities.json', true],
    ['a/b/c.txt', true],
    // 绝对路径 / 穿越 / 盘符 / 反斜杠 / 空段 全部拒绝
    ['/etc/passwd', false],
    ['C:/evil.txt', false],
    ['C:\\evil.txt', false],
    ['../escape.txt', false],
    ['a/../../escape.txt', false],
    ['a//b.txt', false],
    ['a/./b.txt', false],
    ['./b.txt', false],
    ['', false],
    ['a\0b', false],
  ])('isSafeEntryName(%j) → %s', (name, expected) => {
    expect(isSafeEntryName(name)).toBe(expected)
  })
})

describe('createZip / readZipBuffer round-trip', () => {
  it('常规文本 + 二进制 + 空文件', () => {
    const entries = [
      { name: 'settings.json', data: Buffer.from('{"theme":"dark"}', 'utf-8') },
      { name: 'workstation.db', data: Buffer.from([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x00, 0xff]) },
      { name: 'empty.txt', data: Buffer.alloc(0) },
    ]
    const zip = createZip(entries)
    const out = readZipBuffer(zip)
    expect(out.map((e) => e.name)).toEqual(['settings.json', 'workstation.db', 'empty.txt'])
    expect(out[0].data.toString('utf-8')).toBe('{"theme":"dark"}')
    expect([...out[1].data]).toEqual([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x00, 0xff])
    expect(out[2].data.length).toBe(0)
  })

  it('中文文件名(UTF-8 flag) round-trip', () => {
    const entries = [
      { name: 'eaa-data/entities/学生名单.json', data: Buffer.from('张三', 'utf-8') },
      { name: 'eaa-data/events/事件日志.jsonl', data: Buffer.from('事件1\n事件2\n', 'utf-8') },
    ]
    const out = readZipBuffer(createZip(entries))
    expect(out[0].name).toBe('eaa-data/entities/学生名单.json')
    expect(out[0].data.toString('utf-8')).toBe('张三')
    expect(out[1].name).toBe('eaa-data/events/事件日志.jsonl')
  })

  it('不可压缩数据(store 回退) round-trip', () => {
    // 已压缩数据 deflate 无收益,应走 store 分支
    const random = Buffer.alloc(64 * 1024)
    for (let i = 0; i < random.length; i++) random[i] = (i * 7 + 13) & 0xff
    const out = readZipBuffer(createZip([{ name: 'blob.bin', data: random }]))
    expect(out[0].data.equals(random)).toBe(true)
  })

  it('大量条目 round-trip', () => {
    const entries = Array.from({ length: 200 }, (_, i) => ({
      name: `eaa-data/events/log-${String(i).padStart(3, '0')}.jsonl`,
      data: Buffer.from(`entry-${i}`, 'utf-8'),
    }))
    const out = readZipBuffer(createZip(entries))
    expect(out.length).toBe(200)
    expect(out[199].data.toString('utf-8')).toBe('entry-199')
  })

  it('读取 zip 文件(readZipFile)', async () => {
    const tmp = path.join(os.tmpdir(), `zip-test-${Date.now()}.zip`)
    try {
      const zip = createZip([{ name: 'a.txt', data: Buffer.from('hello zip', 'utf-8') }])
      await fsp.writeFile(tmp, zip)
      const out = await readZipFile(tmp)
      expect(out[0].data.toString('utf-8')).toBe('hello zip')
    } finally {
      await fsp.rm(tmp, { force: true })
    }
  })
})

describe('损坏/恶意 zip 拒绝', () => {
  it('非 zip 数据(EOCD 找不到)抛错', () => {
    const garbage = Buffer.from('this is not a zip file at all'.repeat(10), 'utf-8')
    expect(() => readZipBuffer(garbage)).toThrow('EOCD not found')
  })

  it('截断的 zip 抛错', () => {
    const zip = createZip([{ name: 'a.txt', data: Buffer.from('data', 'utf-8') }])
    const truncated = zip.subarray(0, Math.floor(zip.length / 2))
    expect(() => readZipBuffer(truncated)).toThrow()
  })

  it('篡改数据(CRC 校验失败)抛错', () => {
    const zip = createZip([{ name: 'a.txt', data: Buffer.from('original data', 'utf-8') }])
    // 找到 local header 之后的数据区开头并改一个字节
    const nameLen = zip.readUInt16LE(26)
    const dataStart = 30 + nameLen
    zip[dataStart] ^= 0xff
    expect(() => readZipBuffer(zip)).toThrow('CRC mismatch')
  })
})
