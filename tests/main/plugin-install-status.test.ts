import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readEducationPluginInstall } from '../../src/main/services/dsh/plugin-status'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eaa-plugin-status-'))
  dirs.push(dir)
  return dir
}

function writePlugin(root: string, dirName: string): void {
  const dir = join(root, dirName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: `@education-advisor/${dirName}`, version: '0.1.0' }),
  )
}

function writeStamp(home: string, name: string, body: string): void {
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, name), `${body}\n`)
}

describe('readEducationPluginInstall', () => {
  it('教师对话和连接中心的安装戳都对上才算已接入', () => {
    const vendor = tempDir()
    const sdk = tempDir()
    const web = tempDir()
    for (const name of ['eaa-roster', 'eaa-grades', 'eaa-grading', 'eaa-tools']) {
      writePlugin(vendor, name)
      const stamp = `@education-advisor/${name}@0.1.0`
      writeStamp(sdk, `eaa-plugin.sdk.${name}.stamp`, stamp)
      writeStamp(web, `eaa-plugin.web.${name}.stamp`, stamp)
    }
    writeStamp(web, 'eaa-dsh-im.stamp', '4.37.0+panel1')

    expect(
      readEducationPluginInstall({
        vendorRoot: vendor,
        sdkHome: sdk,
        webHome: web,
        imStampName: 'eaa-dsh-im.stamp',
        imStampValue: '4.37.0+panel1',
      }),
    ).toEqual({
      im: true,
      roster: true,
      grades: true,
      grading: true,
      conduct: true,
    })
  })

  it('只装在一边、版本不对、或操行仍用旧戳时如实返回', () => {
    const vendor = tempDir()
    const sdk = tempDir()
    const web = tempDir()
    writePlugin(vendor, 'eaa-roster')
    writePlugin(vendor, 'eaa-grades')
    writePlugin(vendor, 'eaa-tools')
    writeStamp(sdk, 'eaa-plugin.sdk.eaa-roster.stamp', '@education-advisor/eaa-roster@0.1.0')
    writeStamp(sdk, 'eaa-plugin.sdk.eaa-grades.stamp', '@education-advisor/eaa-grades@0.0.9')
    writeStamp(web, 'eaa-plugin.web.eaa-grades.stamp', '@education-advisor/eaa-grades@0.0.9')
    writeStamp(sdk, 'eaa-tools.sdk.stamp', '@education-advisor/eaa-tools@0.1.0')
    writeStamp(web, 'eaa-tools.web.stamp', '@education-advisor/eaa-tools@0.1.0')
    writeStamp(web, 'eaa-dsh-im.stamp', '4.36.0+panel1')

    const row = readEducationPluginInstall({
      vendorRoot: vendor,
      sdkHome: sdk,
      webHome: web,
      imStampName: 'eaa-dsh-im.stamp',
      imStampValue: '4.37.0+panel1',
    })
    expect(row.im).toBe(false)
    expect(row.roster).toBe(false)
    expect(row.grades).toBe(false)
    expect(row.grading).toBe(false)
    expect(row.conduct).toBe(true)
  })
})
