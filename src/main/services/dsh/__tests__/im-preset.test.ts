import { ok } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { EAA_AGENTS_INSTRUCTION_BYTES } from '../agents-home'
import {
  buildEaaImPresetPatch,
  buildOfficialPresetLock,
  EAA_IM_PERSONA_PREFIX,
  ensureEaaImPresetPatch,
  ensureOfficialPresetLock,
  readStandardPresetPlugin,
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
  /tool-bash|tool-pwsh|tool-fs|tool-web|tool-subagent|terminal|plugin-manager|tool-schedule|tool-jobs|tool-todo|tool-goal|command-goal|tool-workflow|workflow-ptc|tool-ralph|plan-mode|tool-cordis|tool-ask-user|tool-present/

describe('连接中心教育预设', () => {
  it('说明上限盖过官方值，压缩组采用已安装的标准预设', () => {
    const bin = resolveDshEntryPath(process.cwd())
    ok(bin, 'dsh entry path should resolve')
    const presetDir = resolveWebPresetDir(bin)
    ok(presetDir, 'web preset dir should resolve')
    const compaction = readStandardPresetPlugin(presetDir, 'compaction')
    expect(compaction?.name).toBe('cordis:group')
    const text = buildEaaImPresetPatch('C:/skills/im', {
      agentInstructions: { maxBytes: 65536, note: 'keep' },
      compaction,
    })
    expect(text).toContain('note: keep')
    expect(text).toContain(`maxBytes: ${EAA_AGENTS_INSTRUCTION_BYTES}`)
    expect(text).not.toContain('maxBytes: 65536')
    expect(text).toContain('@deepseek-ai/dsh-compaction-basic')
    expect(text).toContain('@deepseek-ai/dsh-command-compact')
  })

  it('人设和默认预设留下官方字段，教育前缀和默认值盖上去', () => {
    const text = buildEaaImPresetPatch('C:/skills/im', {
      persona: { prefix: 'You are a coding agent', suffix: 'keep-suffix', complete: true },
      registry: { default: 'standard', rememberLast: true },
    })
    expect(text).toContain(EAA_IM_PERSONA_PREFIX)
    expect(text).toContain('suffix: keep-suffix')
    expect(text).toContain('complete: false')
    expect(text).toContain('includeRuntimeContext: false')
    expect(text).not.toContain('You are a coding agent')
    expect(text).toContain('rememberLast: true')
    expect(text).toContain('default: eaa')
    expect(text).not.toContain('default: standard')
  })

  it('技能行留下官方字段，扫描范围仍钉在这次的目录', () => {
    const text = buildEaaImPresetPatch('C:/skills/im', {
      skillFilesystem: {
        providerName: 'filesystem',
        includeDefaultRoots: true,
        watch: true,
        customSkillDirs: ['C:/somewhere-else'],
      },
    })
    expect(text).toContain('providerName: filesystem')
    expect(text).toContain('includeDefaultRoots: false')
    expect(text).toContain('watch: false')
    expect(text).toContain('C:/skills/im')
    expect(text).not.toContain('C:/somewhere-else')
  })

  it('时间和技能工具采用已安装标准预设里的那一行', () => {
    const text = buildEaaImPresetPatch('C:/skills/im', {
      timeContext: {
        id: 'time-context',
        name: '@deepseek-ai/dsh-time-context',
        config: { hourCycle: 'h23' },
      },
      toolSkill: {
        id: 'tool-skill',
        name: '@deepseek-ai/dsh-tool-skill',
        config: { preload: false },
      },
    })
    expect(text).toContain('hourCycle: h23')
    expect(text).toContain('preload: false')
    expect(text).toContain('@deepseek-ai/dsh-time-context')
    expect(text).toContain('@deepseek-ai/dsh-tool-skill')
  })

  it('默认预设带说明、技能和官方压缩组，技能目录钉在预设自己的那一行', () => {
    const text = buildEaaImPresetPatch('C:\\skills\\im')
    const rows = parse(text) as Array<{
      insert?: Array<{
        id: string
        config: { id: string; plugins: Array<{ name: string; config?: unknown }> }
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
      'cordis:group',
    ])
    const compaction = preset?.config.plugins.find((row) => row.name === 'cordis:group')
    const compactionConfig = compaction?.config as
      | Array<{ name?: string; config?: { thresholdChars?: number } }>
      | undefined
    expect(compactionConfig?.map((row) => row.name)).toEqual([
      '@deepseek-ai/dsh-compaction-basic',
      '@deepseek-ai/dsh-command-compact',
      '@deepseek-ai/dsh-compaction-tool-result-pruner',
    ])
    expect(compactionConfig?.[2]?.config).toEqual({
      thresholdChars: 8192,
      headChars: 4096,
      tailChars: 1024,
    })
    const instructions = preset?.config.plugins.find(
      (row) => row.name === '@deepseek-ai/dsh-agent-instructions',
    )
    expect(instructions?.config).toEqual({ maxBytes: EAA_AGENTS_INSTRUCTION_BYTES })
    const skills = preset?.config.plugins.find(
      (row) => row.name === '@deepseek-ai/dsh-skill-filesystem',
    )
    const skillConfig = skills?.config as { dshHome?: unknown; agentsHome?: unknown } | undefined
    expect(skillConfig).toMatchObject({
      includeDefaultRoots: false,
      customSkillDirs: ['C:/skills/im', 'C:/skills'],
    })
    expect(skillConfig).not.toHaveProperty('dshHome')
    expect(skillConfig).not.toHaveProperty('agentsHome')
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
    expect(shells.has('@deepseek-ai/dsh-tool-ask-user')).toBe(true)
    expect(shells.has('@deepseek-ai/dsh-tool-present')).toBe(true)
    expect(skillExpr).toContain('@deepseek-ai/dsh-agent-preset/package.json')
    expect(text).toContain('coding agent')
    expect(text).not.toContain('你是班级操行助手')
    const standard = rows.find((row) => row.config.id === 'standard')
    expect(standard?.config.name).toBeUndefined()
    expect(standard?.config.description).toBeUndefined()
  })

  it('不改写官方预设的技能目录，也不往精简模式塞教育插件', () => {
    const bin = resolveDshEntryPath(process.cwd())
    ok(bin, 'dsh entry path should resolve')
    const presetDir = resolveWebPresetDir(bin)
    ok(presetDir, 'web preset dir should resolve')
    const text = buildOfficialPresetLock(presetDir)
    ok(text, 'preset lock yaml should be non-empty')
    const rows = parse(text, { customTags: [JS_TAG], version: '1.1' }) as Array<{
      config: { id?: string; plugins: Array<{ name?: string }> }
    }>
    expect(text).toContain('dsh-agent-preset/package.json')
    expect(text).not.toContain('C:/skills/im')
    const minimal = rows.find((row) => row.config.id === 'minimal')
    const names = (minimal?.config.plugins ?? []).map((row) => row.name)
    expect(names).not.toContain('@deepseek-ai/dsh-skill-filesystem')
    expect(names).not.toContain('@deepseek-ai/dsh-tool-skill')
    expect(names).not.toContain('@deepseek-ai/dsh-agent-instructions')
  })

  it('dsh 拼出来的 web 配置里，教育预设是默认，预设内的命令行是关的', () => {
    const bin = resolveDshEntryPath(process.cwd())
    ok(bin, 'dsh entry path should resolve')
    const home = mkdtempSync(join(tmpdir(), 'eaa-preset-dump-'))
    try {
      const patchDir = join(home, 'patches')
      mkdirSync(patchDir)
      const preset = ensureEaaImPresetPatch(patchDir, 'C:/skills/im', bin)
      const lock = ensureOfficialPresetLock(patchDir, bin)
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
      expect(dumped).toContain('@deepseek-ai/dsh-compaction-basic')
      expect(dumped).toContain('@deepseek-ai/dsh-command-compact')
      const lockAt = dumped.lastIndexOf('eaa-preset-lock.cordis.patch.yml')
      expect(lockAt).toBeGreaterThanOrEqual(0)
      const lockNext = dumped.indexOf('# ==', lockAt + 10)
      const lockLayer = dumped.slice(lockAt, lockNext === -1 ? undefined : lockNext)
      expect(lockLayer).toContain('coding agent')
      expect(lockLayer).not.toContain('你是班级操行助手')
      expect(lockLayer).not.toContain('教育工具和技能')
      const presetBash =
        dumped.match(/name: '@deepseek-ai\/dsh-tool-bash'\n\s+disabled: true/g) ?? []
      expect(presetBash.length).toBeGreaterThanOrEqual(3)
      expect(dumped).toMatch(/name: '@deepseek-ai\/dsh-tool-ask-user'\n\s+disabled: true/)
      expect(dumped).toMatch(/name: '@deepseek-ai\/dsh-tool-present'\n\s+disabled: true/)
      expect(dumped).toContain('- C:/skills/im')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
