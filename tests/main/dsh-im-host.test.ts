// =============================================================
// DshImWebHost — dsh-im Web 宿主单元测试
// 真实目录布局 + 假子进程(spawn mock)驱动:
//   前置防呆(dshBin/imDir/panel 缺失)、公告解析成功流、
//   并发 open 去重、url 缓存、120s 超时自愈、先退错误带回显、
//   stop 状态清零与 stamp 免重装、prepareLaunch 注入透传。
// =============================================================

import { EventEmitter } from 'node:events'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
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

import { DSH_IM_STAMP, DshImWebHost } from '../../src/main/services/dsh/im-host'

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
  // run()/runPnpm 的 exit(0) 走微任务,让两层 await 都走完
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

  it('打包态: 子进程 PATH 前置随包 @pnpm/exe，修复 plugin add 找不到 pnpm', async () => {
    // 复现安装版布局：electron-builder 会剥掉 node_modules/.bin，包里只有
    // @pnpm/exe.win32-x64 的真二进制 —— dsh 内部 execa("pnpm") 靠这份 PATH 命中。
    const layout = makeLayout()
    const nmBin = join(layout.root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    mkdirSync(dirname(nmBin), { recursive: true })
    writeFileSync(nmBin, '')
    const exeDir = join(layout.root, 'node_modules', '@pnpm', 'exe.win32-x64')
    mkdirSync(exeDir, { recursive: true })
    writeFileSync(join(exeDir, 'pnpm.exe'), '')
    const host = makeHost({ ...layout, dshBin: nmBin })
    const p = host.open()
    await flushHelpers()
    webChildren()[0].stdout.emit('data', 'dsh web: http://127.0.0.1:9/?t=e')
    await p
    const addRec = recs.find((r) => !r.isWeb) as SpawnRec
    expect(addRec.opts.env?.PATH?.startsWith(exeDir)).toBe(true)
  })

  it('依赖在线安装: 默认 npmmirror 镜像 + 进度事件上抛', async () => {
    const layout = makeLayoutWithoutDeps()
    const progress: Array<{ phase: string; message: string }> = []
    const host = makeHost(layout, { onProgress: (p: { phase: string; message: string }) => progress.push(p) })
    const p = host.open()
    await flushHelpers()
    // 首个非 web 子进程是 ensurePluginDeps 的 pnpm install
    const pnpmRec = recs.find((r) => !r.isWeb) as SpawnRec
    expect(pnpmRec.args).toContain('install')
    expect(pnpmRec.args).toContain('--registry')
    expect(pnpmRec.args).toContain('https://registry.npmmirror.com')
    // pnpm 的 stdout 行转成 deps 阶段进度
    pnpmRec.child.stdout.emit('data', 'Packages: +qrcode@1.5.4\n')
    pnpmRec.child.stdout.emit('data', 'Progress: resolved 120, reused 100\n')
    webChildren()[0].stdout.emit('data', 'dsh web: http://127.0.0.1:7/?t=p')
    const r = await p
    expect(r.ok).toBe(true)
    expect(progress.some((x) => x.phase === 'deps' && x.message.includes('npmmirror'))).toBe(true)
    expect(progress.some((x) => x.phase === 'deps' && x.message.includes('+qrcode'))).toBe(true)
  })

  it('镜像源失败退回默认源: 第二次 pnpm install 不带 --registry', async () => {
    const layout = makeLayoutWithoutDeps()
    // 第一次 pnpm install 失败（镜像不可达），后续全部成功
    mocks.spawn.mockImplementationOnce(((command: string, args: string[], opts: unknown) => {
      const child = makeFakeChild()
      recs.push({ command, args, opts: opts as SpawnRec['opts'], child, isWeb: false })
      queueMicrotask(() => {
        child.stderr.emit('data', 'ERR_PNPM_META_FETCH_FAIL')
        child.emit('exit', 1)
      })
      return child
    }) as never)
    const progress: Array<{ phase: string; message: string }> = []
    const host = makeHost(layout, { onProgress: (p: { phase: string; message: string }) => progress.push(p) })
    const p = host.open()
    await flushHelpers()
    webChildren()[0].stdout.emit('data', 'dsh web: http://127.0.0.1:8/?t=f')
    const r = await p
    expect(r.ok).toBe(true)
    const installs = recs.filter((x) => !x.isWeb && x.args.includes('install'))
    expect(installs).toHaveLength(2)
    expect(installs[0].args).toContain('--registry')
    expect(installs[1].args).not.toContain('--registry')
    expect(progress.some((x) => x.message.includes('默认源'))).toBe(true)
  })

  it('prewarmDeps: 只装依赖不启 web', async () => {
    const layout = makeLayoutWithoutDeps()
    const host = makeHost(layout)
    await host.prewarmDeps()
    await flushHelpers()
    expect(recs.some((r) => !r.isWeb && r.args.includes('install'))).toBe(true)
    expect(webChildren()).toHaveLength(0)
  })

  it('EAA_NPM_REGISTRY=default: 直接用默认源，不做二次重试', async () => {
    const layout = makeLayoutWithoutDeps()
    const host = makeHost(layout, { env: { EAA_NPM_REGISTRY: 'default' } })
    const p = host.open()
    await flushHelpers()
    webChildren()[0].stdout.emit('data', 'dsh web: http://127.0.0.1:10/?t=d')
    await p
    const installs = recs.filter((x) => !x.isWeb && x.args.includes('install'))
    expect(installs).toHaveLength(1)
    expect(installs[0].args).not.toContain('--registry')
  })

  it('stamp 免重装: stop 后重开不再跑 plugin add', async () => {
    const layout = makeLayout()
    const host = makeHost(layout)
    let p = host.open()
    await flushHelpers()
    webChildren()[0].stdout.emit('data', 'dsh web: http://127.0.0.1:2/?t=y')
    await p
    expect(recs.filter((r) => !r.isWeb).length).toBe(2) // 两次 plugin add

    host.stop()
    recs = []
    p = host.open()
    await flushHelpers()
    webChildren()[0].stdout.emit('data', 'dsh web: http://127.0.0.1:3/?t=z')
    await p
    expect(recs.filter((r) => !r.isWeb).length).toBe(0) // stamp 生效
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