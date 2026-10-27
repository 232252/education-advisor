import { ok } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  buildEaaImPresetPatch,
  buildOfficialPresetLock,
  ensureEaaImPresetPatch,
  ensureOfficialPresetLock,
  resolveWebPresetDir,
} from '../im-preset'
import { resolveDshEntryPath } from '../runtime'

const JS_TAG = {
  identify: (value: unknown) =>
    Boolean(value && typeof value === 'object' && value !== null && Object.hasOwn(value, '__js')),
  tag: 'tag:yaml.org,2002:js',
  resolve: (value: string) => ({ __js: String(value) }),
}

const SHELL_NAME =
  /tool-bash|tool-pwsh|tool-fs|tool-web|tool-subagent|terminal|plugin-manager|tool-schedule|tool-jobs|tool-todo|tool-goal|command-goal|tool-workflow|workflow-ptc|tool-ralph|plan-mode|tool-cordis/

describe('连接中心教育预设', () => {
  it('默认预设只有说明和技能，技能目录钉在预设自己的那一行', () => {
    const text = buildEaaImPresetPatch('C:\\skills\\im')
    const rows = parse(text) as Array<{
      insert?: Array<{
        id: string
        config: { id: string; plugins: Array<{ name: string; config?: Record<string, unknown> }> }
      }>
      id?: string
      config?: { default?: string }
    }>
    const preset = rows[0]?.insert?.[0]
    expect(preset?.id).toBe('preset-eaa')
    expect(preset?.config.id).toBe('eaa')
    const names = preset?.config.plugins.map((row) => row.name) ?? []
    expect(names).toEqual([
      '@deepseek-ai/dsh-persona',
      '@deepseek-ai/dsh-agent-instructions',
      '@deepseek-ai/dsh-time-context',
      '@deepseek-ai/dsh-skill-filesystem',
      '@deepseek-ai/dsh-tool-skill',
    ])
    const skills = preset?.config.plugins.find(
      (row) => row.name === '@deepseek-ai/dsh-skill-filesystem',
    )
    expect(skills?.config).toMatchObject({
      includeDefaultRoots: false,
      customSkillDirs: ['C:/skills/im'],
    })
    expect(text).not.toContain('dsh-tool-bash')
    expect(text).not.toContain('dsh-tool-fs')
    expect(rows[1]).toMatchObject({ id: 'agent-preset-registry', config: { default: 'eaa' } })
  })

  it('官方预设里的命令行关掉，技能表达式还在', () => {
    const bin = resolveDshEntryPath(process.cwd())
    ok(bin, 'dsh entry path should resolve')
    const presetDir = resolveWebPresetDir(bin)
    ok(presetDir, 'web preset dir should resolve')
    const text = buildOfficialPresetLock(presetDir)
    ok(text, 'preset lock yaml should be non-empty')
    const rows = parse(text, { customTags: [JS_TAG], version: '1.1' }) as Array<{
      id: string
      config: { id: string; name?: string; description?: string; plugins: unknown[] }
    }>
    expect(rows.map((row) => row.config.id).sort()).toEqual([
      'cordis',
      'minimal',
      'ptc',
      'standard',
    ])
    const shells = new Set<string>()
    const keptShells = new Set<string>()
    const keptSafe = new Set<string>()
    let skillExpr = ''
    const walk = (entries: unknown) => {
      if (!Array.isArray(entries)) return
      for (const row of entries) {
        if (!row || typeof row !== 'object') continue
        const entry = row as { name?: string; disabled?: unknown; config?: unknown }
        if (typeof entry.name === 'string' && SHELL_NAME.test(entry.name)) {
          if (entry.disabled === true) shells.add(entry.name)
          else keptShells.add(entry.name)
        }
        if (
          entry.name === '@deepseek-ai/dsh-skill-filesystem' ||
          entry.name === '@deepseek-ai/dsh-tool-skill' ||
          entry.name === '@deepseek-ai/dsh-persona' ||
          entry.name === '@deepseek-ai/dsh-agent-instructions'
        ) {
          if (entry.disabled !== true) keptSafe.add(entry.name)
        }
        if (
          entry.name === '@deepseek-ai/dsh-skill-filesystem' &&
          entry.config &&
          typeof entry.config === 'object'
        ) {
          const dirs = (entry.config as { customSkillDirs?: unknown[] }).customSkillDirs
          const expr = dirs?.find(
            (item) => item && typeof item === 'object' && '__js' in (item as object),
          ) as { __js?: string } | undefined
          if (expr?.__js) skillExpr = expr.__js
        }
        if (Array.isArray(entry.config)) walk(entry.config)
        else if (entry.config && typeof entry.config === 'object') {
          walk((entry.config as { plugins?: unknown }).plugins)
        }
      }
    }
    for (const row of rows) walk(row.config.plugins)
    expect([...keptShells]).toEqual([])
    expect(shells.has('@deepseek-ai/dsh-tool-bash')).toBe(true)
    expect(shells.has('@deepseek-ai/dsh-tool-fs')).toBe(true)
    expect(shells.has('@deepseek-ai/dsh-tool-web')).toBe(true)
    expect(shells.has('@deepseek-ai/dsh-tool-bash-persistent')).toBe(true)
    expect(shells.has('@deepseek-ai/dsh-tool-subagent')).toBe(true)
    expect(keptSafe.has('@deepseek-ai/dsh-skill-filesystem')).toBe(true)
    expect(keptSafe.has('@deepseek-ai/dsh-tool-skill')).toBe(true)
    expect(skillExpr).toContain('@deepseek-ai/dsh-agent-preset/package.json')
    expect(text).not.toContain('coding agent')
    expect(text).not.toContain('working directory')
    expect(text).toContain('你是班级操行助手')
    const standard = rows.find((row) => row.config.id === 'standard')
    expect(standard?.config.name).toBe('标准')
    expect(standard?.config.description).toContain('教育工具和技能')
  })

  it('给出技能目录时，官方预设的 skill-filesystem 只扫描这一份', () => {
    const bin = resolveDshEntryPath(process.cwd())
    ok(bin, 'dsh entry path should resolve')
    const presetDir = resolveWebPresetDir(bin)
    ok(presetDir, 'web preset dir should resolve')
    const text = buildOfficialPresetLock(presetDir, 'C:\\skills\\im')
    ok(text, 'preset lock yaml should be non-empty')
    const rows = parse(text, { customTags: [JS_TAG], version: '1.1' }) as Array<{
      config: { id?: string; plugins: Array<{ name?: string }> }
    }>
    const dirs = new Set<string>()
    const walk = (entries: unknown) => {
      if (!Array.isArray(entries)) return
      for (const row of entries) {
        if (!row || typeof row !== 'object') continue
        const entry = row as { name?: string; config?: unknown }
        if (
          entry.name === '@deepseek-ai/dsh-skill-filesystem' &&
          entry.config &&
          typeof entry.config === 'object'
        ) {
          const custom = (
            entry.config as { customSkillDirs?: string[]; includeDefaultRoots?: boolean }
          ).customSkillDirs
          expect((entry.config as { includeDefaultRoots?: boolean }).includeDefaultRoots).toBe(
            false,
          )
          for (const dir of custom ?? []) dirs.add(dir)
        }
        if (Array.isArray(entry.config)) walk(entry.config)
        else if (entry.config && typeof entry.config === 'object') {
          walk((entry.config as { plugins?: unknown }).plugins)
        }
      }
    }
    for (const row of rows) walk(row.config.plugins)
    expect([...dirs]).toEqual(['C:/skills/im'])
    expect(text).not.toContain('dsh-agent-preset/package.json')
    const minimal = rows.find((row) => row.config.id === 'minimal')
    const names = (minimal?.config.plugins ?? []).map((row) => row.name)
    expect(names).toContain('@deepseek-ai/dsh-skill-filesystem')
    expect(names).toContain('@deepseek-ai/dsh-tool-skill')
    expect(names).toContain('@deepseek-ai/dsh-agent-instructions')
  })

  it('dsh 拼出来的 web 配置里，教育预设是默认，预设内的命令行是关的', () => {
    const bin = resolveDshEntryPath(process.cwd())
    ok(bin, 'dsh entry path should resolve')
    const home = mkdtempSync(join(tmpdir(), 'eaa-preset-dump-'))
    try {
      const patchDir = join(home, 'patches')
      mkdirSync(patchDir)
      const preset = ensureEaaImPresetPatch(patchDir, 'C:/skills/im')
      const lock = ensureOfficialPresetLock(patchDir, bin, 'C:/skills/im')
      ok(lock, 'preset lock should be written')
      const result = spawnSync(
        process.execPath,
        [bin, 'web', '--patch', preset, '--patch', lock, '--dump-config'],
        { cwd: process.cwd(), env: { ...process.env, DSH_HOME: home }, encoding: 'utf8' },
      )
      expect(result.status).toBe(0)
      const dumped = result.stdout
      expect(dumped).toContain('id: preset-eaa')
      expect(dumped).toContain('name: 教育参谋')
      expect(dumped).toContain('按班级操行助手回答，只用当前列出的教育工具和技能。')
      expect(dumped).toContain('includeRuntimeContext: false')
      expect(dumped).toContain('default: eaa')
      const lockAt = dumped.lastIndexOf('eaa-preset-lock.cordis.patch.yml')
      expect(lockAt).toBeGreaterThanOrEqual(0)
      const lockNext = dumped.indexOf('# ==', lockAt + 10)
      const lockLayer = dumped.slice(lockAt, lockNext === -1 ? undefined : lockNext)
      expect(lockLayer).toContain('name: 标准')
      expect(lockLayer).toContain('教育工具和技能')
      expect(lockLayer).toContain('你是班级操行助手')
      expect(lockLayer).not.toContain('coding agent')
      expect(lockLayer).not.toContain('software engineer')
      expect(lockLayer).not.toContain('working directory')
      const presetBash =
        dumped.match(/name: '@deepseek-ai\/dsh-tool-bash'\n\s+disabled: true/g) ?? []
      expect(presetBash.length).toBeGreaterThanOrEqual(3)
      expect(dumped).toContain('- C:/skills/im')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
