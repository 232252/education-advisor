// =============================================================
// SettingsPage — 页面级冒烟与关键契约测试
// 覆盖: 加载态→渲染九大 Section、settings.get 失败的错误态+重试、
//       语言切换写入 general.language、重置确认弹窗流、
//       feishu.onBotStatusUpdate 订阅退订
// getAPI 用深度自动 mock(任意属性链返回可调用节点,默认
// resolve {success:true,data:[]}),仅对少数方法给精确 override。
// =============================================================

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const overrides: Record<string, unknown> = {}

/** 深度自动 API: 任意属性链返回可调用节点。
 *  方法的返回值是「可调用 thenable」: 既可作 effect cleanup 函数(unsub),
 *  又可 await 得到 {success:true,data:[]} — 两种消费形态都不会炸。 */
const OK = { success: true, data: [], message: '' }
function makeCallableThenable(): any {
  const ret: any = () => undefined
  ret.then = (onRes: (v: unknown) => unknown, onRej?: (e: unknown) => unknown) =>
    Promise.resolve(OK).then(onRes, onRej)
  return ret
}
function autoApi(memo = new Map<PropertyKey, unknown>()): any {
  const fn: any = vi.fn(() => makeCallableThenable())
  return new Proxy(fn, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
      if (!memo.has(prop)) memo.set(prop, autoApi(new Map()))
      return memo.get(prop)
    },
    apply(target) {
      return target()
    },
  })
}

const api = autoApi()
// 关键 override(必须的精确行为)
api.settings.get = vi.fn(async () => ({}))
api.settings.set = vi.fn(async () => ({ success: true }))
api.settings.reset = vi.fn(async () => ({ success: true }))
api.feishu.onBotStatusUpdate = vi.fn(() => () => {})
api.feishu.botStatus = vi.fn(async () => null)
api.sys.onUpdateProgress = vi.fn(() => () => {})
api.sys.getVersion = vi.fn(async () => '0.0.0-test')
api.sys.checkUpdate = vi.fn(async () => ({ hasUpdate: false, currentVersion: '0', latestVersion: '0' }))
api.eaa.doctor = vi.fn(async () => ({ healthy: true, passed: 0, failed: 0, issues: [] }))
api.eaa.validate = vi.fn(async () => ({ valid: true, total_events: 0, errors: [], warnings: [] }))
api.log.list = vi.fn(async () => ({ success: true, data: [] }))
api.memory.list = vi.fn(async () => ({ success: true, data: [] }))
api.backup.listAuto = vi.fn(async () => ({ success: true, data: [] }))
void overrides

const mocks = vi.hoisted(() => ({ setLang: vi.fn(() => Promise.resolve()) }))
// t 必须是稳定引用 — 页面的 loadSettings useCallback([t]),身份一变 effect
// 就重跑(死循环式刷新)。mock 返回模块级同一个函数。
const stableT = vi.hoisted(() => {
  const DICT: Record<string, string> = {
    'settings.section.general': '通用',
    'settings.section.chat': '对话',
    'settings.section.feishu': '飞书',
    'settings.section.mcp': 'MCP 集成',
    'settings.section.data': '数据与备份',
    'settings.section.logs': '日志查看',
    'settings.section.about': '关于',
    'common.loading': '加载中...',
    'common.retry': '重试',
    'settings.reset': '恢复默认',
    'settings.language.zh': '中文',
  }
  const t = (key: string, fallback?: unknown) =>
    DICT[key] ?? (typeof fallback === 'string' ? fallback : key)
  return { t }
})
vi.mock('../../../../src/renderer/i18n', () => ({
  useT: () => ({ t: stableT.t, lang: 'zh' }),
  tr: stableT.t,
  // ConfirmDialog 等共享组件用模块级 t 提供默认文案
  t: stableT.t,
  setLang: mocks.setLang,
}))

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => api,
  errText: (e: unknown) => String(e),
}))

import { Component, type ReactNode } from 'react'
class DumpBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  componentDidCatch(err: Error, info: { componentStack?: string }) {
    console.log('--- COMPONENT STACK ---')
    console.log(info.componentStack)
    this.state = { err }
  }
  static getDerivedStateFromError(err: Error) {
    return { err }
  }
  render() {
    if (this.state.err) return createElement('div', null, 'BOUNDARY')
    return this.props.children
  }
}

import { SettingsPage } from '../../../../src/renderer/pages/Settings/SettingsPage'

beforeEach(() => {
  vi.clearAllMocks()
  api.settings.get = vi.fn(async () => ({}))
})

describe('SettingsPage', () => {
  it('加载后渲染全部 Section 标题', async () => {
    render(createElement(DumpBoundary, null, createElement(SettingsPage)))
    await waitFor(() => expect(screen.getByText('通用')).toBeTruthy())
    expect(screen.getByText('对话')).toBeTruthy()
    expect(screen.getByText('飞书')).toBeTruthy()
    expect(screen.getByText('MCP 集成')).toBeTruthy()
    expect(screen.getByText('数据与备份')).toBeTruthy()
    expect(screen.getByText('日志查看')).toBeTruthy()
    expect(screen.getByText('关于')).toBeTruthy()
    expect(api.settings.get).toHaveBeenCalled()
  })

  it('加载中显示 loading 态(挂起期间)', async () => {
    api.settings.get = vi.fn(() => new Promise(() => {})) // 永不 resolve
    render(createElement(DumpBoundary, null, createElement(SettingsPage)))
    expect(screen.getByText('加载中...')).toBeTruthy()
    expect(screen.queryByText('通用')).toBeNull()
  })

  it('settings.get 失败 → 错误态 + 重试按钮,重试成功恢复', async () => {
    api.settings.get = vi.fn(async () => {
      throw new Error('IPC 断开')
    })
    render(createElement(DumpBoundary, null, createElement(SettingsPage)))
    await waitFor(() => expect(screen.getByText(/重试/)).toBeTruthy())
    // 重试成功
    api.settings.get = vi.fn(async () => ({}))
    fireEvent.click(screen.getByText(/重试/))
    await waitFor(() => expect(screen.getByText('通用')).toBeTruthy())
  })

  it('语言切换保存 general.language', async () => {
    render(createElement(DumpBoundary, null, createElement(SettingsPage)))
    await waitFor(() => expect(screen.getByText('通用')).toBeTruthy())
    const select = screen.getByLabelText(/切换界面语言/)
    fireEvent.change(select, { target: { value: 'en' } })
    await waitFor(() =>
      expect(api.settings.set).toHaveBeenCalledWith('general.language', 'en-US'),
    )
  })

  it('重置走确认弹窗,确认后调用 settings.reset', async () => {
    render(createElement(DumpBoundary, null, createElement(SettingsPage)))
    await waitFor(() => expect(screen.getByText('通用')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('恢复默认'))
    // 确认弹窗出现 → 点确认
    const confirmBtn = await screen.findByRole('button', { name: '确认' })
    fireEvent.click(confirmBtn)
    await waitFor(() => expect(api.settings.reset).toHaveBeenCalled())
  })

  it('feishu bot 状态订阅在卸载时退订', async () => {
    const unsub = vi.fn()
    api.feishu.onBotStatusUpdate = vi.fn(() => unsub)
    const { unmount } = render(createElement(DumpBoundary, null, createElement(SettingsPage)))
    await waitFor(() => expect(api.feishu.onBotStatusUpdate).toHaveBeenCalled())
    unmount()
    expect(unsub).toHaveBeenCalled()
  })
})
