// =============================================================
// DshImWebHost — dsh-im Web 宿主单元测试
// 真实目录布局 + 假子进程(spawn mock)驱动:
//   前置防呆(dshBin/imDir/panel 缺失)、公告解析成功流、
//   并发 open 去重、url 缓存、120s 超时自愈、先退错误带回显、
//   stop 状态清零与 stamp 免重装、prepareLaunch 注入透传。
// =============================================================

import { EventEmitter } from 'node:events'
import { mkdtempSync, existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  ensureEaaHardeningPatch: vi.fn(() => '/ph/hardening.yaml'),
  ensureEaaWelcomeNoticePatch: vi.fn(() => '/ph/welcome.yaml'),
  ensureOfficialPresetLock: vi.fn(() => '/ph/preset.lock'),
  ensureProfileHasEaaTools: vi.fn(async () => {}),
}))

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../../src/main/services/dsh/hardening', () => ({
  ensureEaaHardeningPatch: mocks.ensureEaaHardeningPatch,
}))
vi.mock('../../src/main/services/dsh/im-preset', () => ({
  ensureOfficialPresetLock: mocks.ensureOfficialPresetLock,
}))
vi.mock('../../src/main/services/dsh/welcome-notice', () => ({
  ensureEaaWelcomeNoticePatch: mocks.ensureEaaWelcomeNoticePatch,
}))
vi.mock('../../src/main/services/dsh/plugin-install', () => ({
  ensureProfileHasEaaTools: mocks.ensureProfileHasEaaTools,
}))

import { DSH_IM_INSTALL_STAMP, DSH_IM_STAMP, DshImWebHost } from '../../src/main/services/dsh/im-host'
import { dshPluginLinkSpec } from '../../src/main/services/dsh/im-url'
import { packageModuleDir, resolveDshProfileDir } from '../../src/main/services/dsh/plugin-links'

interface FakeChild {
  on: EventEmitter['on']
  once: EventEmitter['once']
  emit: EventEmitter['emit']
  stdout: EventEmitter & { setEncoding: () => void }
  stderr: EventEmitter & { setEncoding: () => void }
  kill: ReturnType<typeof vi.fn>
}

function makeFakeChild(): FakeChild {
  const core = new EventEmitter() as unknown as FakeChild
  const mkStream = () => {
    const s = new EventEmitter() as EventEmitter & { setEncoding: () => void }
    s.setEncoding = () => {}
    return s
  }
  core.stdout = mkStream()
  core.stderr = mkStream()
  core.kill = vi.fn()
  return core
}

interface SpawnRec {
  command: string
  args: string[]
  opts: { cwd?: string; env?: Record<string, string> }
  child: FakeChild
  isWeb: boolean
}

let recs: SpawnRec[] = []

function webChildren(): FakeChild[] {
  return recs.filter((r) => r.isWeb).map((r) => r.child)
}

function flushHelpers(): Promise<void> {
  // 假子进程的 exit(0) 走微任务，让启动流程走完
  return new Promise((resolve) => setTimeout(resolve, 20))
}

function makeLayout() {
  const root = mkdtempSync(join(tmpdir(), 'im-host-test-'))
  const home = join(root, 'home')
  const imDir = join(root, 'dsh-im')
  const panelDir = join(imDir, 'integrations', 'eaa-panel')
  mkdirSync(join(imDir, 'node_modules', 'qrcode'), { recursive: true })
  writeFileSync(join(imDir, 'package.json'), '{}')
  writeFileSync(join(imDir, 'node_modules', 'qrcode', 'package.json'), '{}')
  mkdirSync(panelDir, { recursive: true })
  writeFileSync(join(panelDir, 'package.json'), '{}')
  const dshBin = join(root, 'dsh.js')
  writeFileSync(dshBin, '#!/usr/bin/env node')
  return { root, home, imDir, dshBin }
}

/** 没有 node_modules/qrcode 的布局：触发 ensurePluginDeps 在线安装分支。 */
function makeLayoutWithoutDeps() {
  const layout = makeLayout()
  rmSync(join(layout.imDir, 'node_modules', 'qrcode', 'package.json'), { force: true })
  return layout
}

function makeHost(layout: ReturnType<typeof makeLayout>, extra: Record<string, unknown> = {}) {
  return new DshImWebHost({
    home: layout.home,
    dshBin: layout.dshBin,
    imDir: layout.imDir,
    toolsDir: 'tools-dir',
    execPath: process.execPath,
    electronAsNode: true,
    ...extra,
  } as never)
}

describe('DshImWebHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    recs = []
    mocks.ensureEaaHardeningPatch.mockReturnValue('/ph/hardening.yaml')
    mocks.ensureEaaWelcomeNoticePatch.mockReturnValue('/ph/welcome.yaml')
    mocks.ensureOfficialPresetLock.mockReturnValue('/ph/preset.lock')
    mocks.spawn.mockImplementation(((command: string, args: string[], opts: unknown) => {
      const child = makeFakeChild()
      // web 启动的首实参是 'web'(dshWebLaunchArgs);plugin 命令里
      // 的 'web' 是 profile 名,不能当判据
      const isWeb = Array.isArray(args) && args[1] === 'web'
      recs.push({ command, args, opts: opts as SpawnRec['opts'], child, isWeb })
      if (!isWeb) queueMicrotask(() => child.emit('exit', 0))
      return child
    }) as never)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('前置防呆: dshBin/imDir/panel 缺失给结构化错误,不 spawn', async () => {
    const layout = makeLayout()
    const noBin = makeHost({ ...layout, dshBin: join(layout.root, 'missing.js') })
    const r1 = await noBin.open()
    expect(r1.ok).toBe(false)
    expect(r1.error).toContain('可执行文件')

    const noIm = makeHost({ ...layout, imDir: join(layout.root, 'no-im') })
    const r2 = await noIm.open()
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain('插件目录')

    const altIm = join(layout.root, 'alt-im')
    mkdirSync(altIm, { recursive: true })
    writeFileSync(join(altIm, 'package.json'), '{}')
    const r3 = await makeHost({ ...layout, imDir: altIm }).open()
    expect(r3.ok).toBe(false)
    expect(r3.error).toContain('侧栏插件')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('成功流: 公告解析出 URL,补丁/AGENTS/环境注入透传', async () => {
    const layout = makeLayout()
    const host = makeHost(layout, {
      env: { BASE: '1' },
      prepareLaunch: async () => ({
        patches: ['/p/extra.yaml'],
        env: { MODEL_KEY: 'k' },
        instructions: '教育面板说明',
      }),
    })
    const p = host.open()
    await flushHelpers()
    const web = webChildren()[0]
    web.stdout.emit('data', 'listening ')
    web.stdout.emit('data', 'dsh web: http://127.0.0.1:49333/?token=abc (LAN: x)')
    const r = await p
    expect(r.ok).toBe(true)
    expect(r.url).toBe('http://127.0.0.1:49333/?token=abc')

    // 启动参数: 加固/欢迎/自定义/预设锁 全部 --patch 且在 --host 前
    const webRec = recs.find((x) => x.isWeb) as SpawnRec
    const args = webRec.args
    const patchIdx = args.reduce<number>((last, a, i) => (a === '--patch' ? i : last), -1)
    expect(args.slice(1, patchIdx + 2)).toContain('/ph/hardening.yaml')
    expect(args.slice(1, patchIdx + 2)).toContain('/p/extra.yaml')
    expect(args.indexOf('--host')).toBeGreaterThan(patchIdx)
    expect(args).toContain('--no-open')

    // 环境注入: DSH_HOME + prepareLaunch env + ELECTRON_RUN_AS_NODE
    expect(webRec.opts.env?.DSH_HOME).toBe(layout.home)
    expect(webRec.opts.env?.MODEL_KEY).toBe('k')
    expect(webRec.opts.env?.ELECTRON_RUN_AS_NODE).toBe('1')

    // AGENTS.md 写入 + 安装 stamp 落盘(下次免重装)
    expect(readFileSync(join(layout.home, 'AGENTS.md'), 'utf8')).toBe('教育面板说明')
    expect(existsSync(join(layout.home, DSH_IM_STAMP))).toBe(true)
  })

  it('并发 open 去重: 同一 pending 只 boot 一次;已有 url 立即返回', async () => {
    const layout = makeLayout()
    const host = makeHost(layout)
    const p1 = host.open()
    const p2 = host.open()
    await flushHelpers()
    expect(webChildren().length).toBe(1)
    webChildren()[0].stdout.emit('data', 'dsh web: http://127.0.0.1:1/?t=x')
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.url).toBe(r2.url)

    // 已有 url:不再 spawn,直接缓存返回
    const r3 = await host.open()
    expect(r3.url).toBe(r1.url)
    expect(webChildren().length).toBe(1)
  })

  it('打包态: 子进程 PATH 不前置随包 @pnpm/exe', async () => {
    // 教师包不含 pnpm，连接中心也不再补装依赖。假树按当前运行平台构造。
    const layout = makeLayout()
    const nmBin = join(layout.root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    mkdirSync(dirname(nmBin), { recursive: true })
    writeFileSync(nmBin, '')
    const exeDir = join(layout.root, 'node_modules', '@pnpm', `exe.${process.platform}-${process.arch}`)
    mkdirSync(exeDir, { recursive: true })
    writeFileSync(join(exeDir, process.platform === 'win32' ? 'pnpm.exe' : 'pnpm'), '')
    const host = makeHost({ ...layout, dshBin: nmBin })
    const p = host.open()
    await flushHelpers()
    webChildren()[0].stdout.emit('data', 'dsh web: http://127.0.0.1:9/?t=e')
    await p
    const webRec = recs.find((r) => r.isWeb) as SpawnRec
    expect(webRec.opts.env?.PATH?.includes(exeDir)).toBe(false)
    expect(recs.filter((r) => !r.isWeb)).toHaveLength(0)
  })

  it('随包依赖缺失时要求重装，不调用 pnpm', async () => {
    const layout = makeLayoutWithoutDeps()
    const host = makeHost(layout)
    const r = await host.open()
    expect(r.ok).toBe(false)
    expect(r.error).toContain('重新安装')
    expect(r.error).toContain('pnpm')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('prewarmDeps: 依赖缺失只记警告，不起 web、不调用 pnpm', async () => {
    const layout = makeLayoutWithoutDeps()
    const host = makeHost(layout)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await host.prewarmDeps()
    expect(warn).toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(webChildren()).toHaveLength(0)
  })

  it('stamp 免重装: 写出 link 后重开不再改 profile，也不跑 plugin add', async () => {
    const layout = makeLayout()
    writeFileSync(join(layout.imDir, 'package.json'), JSON.stringify({ name: '@xmanrui/dsh-im', version: '5.10.0' }))
    writeFileSync(
      join(layout.imDir, 'integrations', 'eaa-panel', 'package.json'),
      JSON.stringify({ name: 'eaa-dsh-im-panel', version: '0.1.0' }),
    )
    const host = makeHost(layout)
    let p = host.open()
    await flushHelpers()
    webChildren()[0].stdout.emit('data', 'dsh web: http://127.0.0.1:2/?t=y')
    await p
    expect(recs.filter((r) => !r.isWeb).length).toBe(0)
    expect(readFileSync(join(layout.home, DSH_IM_STAMP), 'utf8').trim()).toBe(DSH_IM_INSTALL_STAMP)
    const profileDir = resolveDshProfileDir(layout.home, 'web')
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(manifest.dependencies['@xmanrui/dsh-im']).toBe(dshPluginLinkSpec(layout.imDir))
    expect(manifest.dependencies['eaa-dsh-im-panel']).toBe(
      dshPluginLinkSpec(join(layout.imDir, 'integrations', 'eaa-panel')),
    )

    host.stop()
    recs = []
    p = host.open()
    await flushHelpers()
    webChildren()[0].stdout.emit('data', 'dsh web: http://127.0.0.1:3/?t=z')
    await p
    expect(recs.filter((r) => !r.isWeb).length).toBe(0)
  })

  it('stamp 在但链接目标缺失或过期时，不跑 plugin add，直接改写到当前路径', async () => {
    const layout = makeLayout()
    writeFileSync(join(layout.imDir, 'package.json'), JSON.stringify({ name: '@xmanrui/dsh-im', version: '5.10.0' }))
    const panelDir = join(layout.imDir, 'integrations', 'eaa-panel')
    writeFileSync(join(panelDir, 'package.json'), JSON.stringify({ name: 'eaa-dsh-im-panel', version: '0.1.0' }))
    mkdirSync(layout.home, { recursive: true })
    writeFileSync(join(layout.home, DSH_IM_STAMP), `${DSH_IM_INSTALL_STAMP}\n`)
    const staleIm = join(layout.root, 'stale-im')
    mkdirSync(join(staleIm, 'integrations', 'eaa-panel'), { recursive: true })
    writeFileSync(join(staleIm, 'package.json'), JSON.stringify({ name: '@xmanrui/dsh-im', version: '5.10.0' }))
    writeFileSync(
      join(staleIm, 'integrations', 'eaa-panel', 'package.json'),
      JSON.stringify({ name: 'eaa-dsh-im-panel', version: '0.1.0' }),
    )
    const profileDir = resolveDshProfileDir(layout.home, 'web')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(
      join(profileDir, 'package.json'),
      JSON.stringify(
        {
          name: 'dsh-profile-web',
          private: true,
          dependencies: {
            '@xmanrui/dsh-im': dshPluginLinkSpec(staleIm),
            'eaa-dsh-im-panel': dshPluginLinkSpec(join(staleIm, 'integrations', 'eaa-panel')),
          },
          dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@xmanrui/dsh-im', 'eaa-dsh-im-panel'] } },
        },
        null,
        2,
      ),
    )

    const host = makeHost(layout)
    const p = host.open()
    await flushHelpers()
    webChildren()[0].stdout.emit('data', 'dsh web: http://127.0.0.1:11/?t=relink')
    const r = await p
    expect(r.ok).toBe(true)
    expect(recs.filter((x) => !x.isWeb)).toHaveLength(0)
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(manifest.dependencies['@xmanrui/dsh-im']).toBe(dshPluginLinkSpec(layout.imDir))
    expect(manifest.dependencies['eaa-dsh-im-panel']).toBe(dshPluginLinkSpec(panelDir))
    expect(realpathSync(packageModuleDir(profileDir, '@xmanrui/dsh-im'))).toBe(realpathSync(layout.imDir))
    expect(realpathSync(packageModuleDir(profileDir, 'eaa-dsh-im-panel'))).toBe(realpathSync(panelDir))
  })

  it('120 秒无公告: 超时自愈 kill + releaseLaunch', async () => {
    vi.useFakeTimers()
    const layout = makeLayout()
    const release = vi.fn(async () => {})
    const host = makeHost(layout, { releaseLaunch: release })
    const p = host.open()
    await vi.advanceTimersByTimeAsync(20)
    await vi.advanceTimersByTimeAsync(120_000)
    const r = await p
    expect(r.ok).toBe(false)
    expect(r.error).toContain('没有打印访问地址')
    expect(webChildren()[0].kill).toHaveBeenCalled()
    expect(release).toHaveBeenCalled()
  })

  it('打印地址前退出: 错误带 code 与尾部日志', async () => {
    const layout = makeLayout()
    const release = vi.fn(async () => {})
    const host = makeHost(layout, { releaseLaunch: release })
    const p = host.open()
    await flushHelpers()
    const web = webChildren()[0]
    web.stderr.emit('data', 'boom detail')
    web.emit('exit', 1)
    const r = await p
    expect(r.ok).toBe(false)
    expect(r.error).toContain('code=1')
    expect(r.error).toContain('boom detail')
    expect(release).toHaveBeenCalled()
  })

  it('stop: kill 子进程并撤端点,状态清零后可重开', async () => {
    const layout = makeLayout()
    const release = vi.fn(async () => {})
    const host = makeHost(layout, { releaseLaunch: release })
    const p = host.open()
    await flushHelpers()
    const web = webChildren()[0]
    web.stdout.emit('data', 'dsh web: http://127.0.0.1:4/?t=w')
    await p
    host.stop()
    expect(web.kill).toHaveBeenCalled()
    expect(release).toHaveBeenCalled()
    // 重开: 新 web 子进程
    const p2 = host.open()
    await flushHelpers()
    expect(webChildren().length).toBe(2)
    webChildren()[1].stdout.emit('data', 'dsh web: http://127.0.0.1:5/?t=v')
    const r2 = await p2
    expect(r2.url).toBe('http://127.0.0.1:5/?t=v')
  })
})