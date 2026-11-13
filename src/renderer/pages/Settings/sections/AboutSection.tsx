// =============================================================
// 关于 Section — 应用版本/底层核心(EAA / DeepSeek Harness / dsh-im / 模型目录 / PII Shield)/ 关键依赖
// 纯展示组件,无 state / callback
// =============================================================

import type { RuntimeVersions } from '@shared/api/sys'
import { useEffect, useState } from 'react'
import { tr, useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { Section } from '../components'

export function AboutSection() {
  const { t } = useT()
  // R2-16: 版本号从主进程运行时读取(app.getVersion = package.json),
  // 此前硬编码 v0.1.0-rc.1 发版必漂移
  const [version, setVersion] = useState('…')
  // 底层运行时版本同样走主进程单一来源(dsh-version / im-url pin / 进程版本),
  // 不再写死在文案里 — Electron 43.2 vs 实际 45 的漂移就是这么来的。
  const [runtime, setRuntime] = useState<RuntimeVersions | null>(null)
  useEffect(() => {
    let alive = true
    getAPI()
      .sys.getVersion()
      .then((v) => {
        if (alive && v) setVersion(v)
      })
      .catch(() => {
        /* 读取失败保持默认,不影响页面 */
      })
    getAPI()
      .sys.getRuntimeVersions()
      .then((v) => {
        if (alive && v) setRuntime(v)
      })
      .catch(() => {
        /* 读取失败保持占位,不影响页面 */
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <Section title={t('settings.section.about')}>
      <div className="px-5 py-5 space-y-4">
        <div>
          <div className="text-base text-gray-800 dark:text-gray-100 font-semibold">
            Education Advisor{' '}
            <span className="text-sm font-normal text-gray-500 dark:text-gray-400">v{version}</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
            {t(
              'page.settings.about.tagline',
              '多智能体教育管理桌面系统 — 18 个教育 AI Agent + Rust 操行引擎 + 隐私脱敏',
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 dark:bg-surface-secondary rounded-lg p-3">
            <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 font-medium">
              {t('page.settings.about.coreTitle', '底层核心')}
            </div>
            <div className="space-y-1.5 text-xs">
              <div>
                <span className="text-blue-500 dark:text-blue-400 font-medium">EAA Core</span>
                <span className="text-gray-500 dark:text-gray-400 text-[11px]">
                  {' '}
                  {t('page.settings.about.core.eaa', '— Rust 操行评分/事件/隐私引擎, 24 子命令')}
                </span>
              </div>
              <div>
                <span className="text-blue-500 dark:text-blue-400 font-medium">
                  {t('page.settings.about.core.agents', '18 教育 Agent')}
                </span>
                <span className="text-gray-500 dark:text-gray-400 text-[11px]">
                  {' '}
                  {t(
                    'page.settings.about.core.agents.desc',
                    '— 参谋/督导/辅导员/心理/纪律/班务等多智能体',
                  )}
                </span>
              </div>
              <div>
                <a
                  href="https://github.com/deepseek-ai/deepseek-harness"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 font-medium"
                >
                  DeepSeek Harness
                </a>
                <span className="text-gray-500 dark:text-gray-400 text-[11px]">
                  {' '}
                  {tr(
                    'page.settings.about.core.dsh',
                    { version: runtime?.dsh ?? '…' },
                    '— Agent 运行时（dsh {version}）',
                  )}
                </span>
              </div>
              <div>
                <a
                  href="https://github.com/xmanrui/dsh-im"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 font-medium"
                >
                  dsh-im
                </a>
                <span className="text-gray-500 dark:text-gray-400 text-[11px]">
                  {' '}
                  {tr(
                    'page.settings.about.core.dshIm',
                    { version: runtime?.dshIm ?? '…' },
                    '— 连接中心插件（dsh-im {version}）',
                  )}
                </span>
              </div>
              <div>
                <a
                  href="https://github.com/earendil-works/pi"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 font-medium"
                >
                  Pi-AI
                </a>
                <span className="text-gray-500 dark:text-gray-400 text-[11px]">
                  {' '}
                  {t('page.settings.about.core.piAi', '— 模型目录（pi-ai 1.4.0）')}
                </span>
              </div>
              <div>
                <span className="text-blue-500 dark:text-blue-400 font-medium">PII Shield</span>
                <span className="text-gray-500 dark:text-gray-400 text-[11px]">
                  {' '}
                  {t('page.settings.about.core.piiShield', '— 隐私脱敏加密引擎')}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-surface-secondary rounded-lg p-3">
            <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 font-medium">
              {t('page.settings.about.depsTitle', '关键依赖')}
            </div>
            <div className="grid grid-cols-1 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400">
              <span>Electron {runtime?.electron || '…'} + React 19.2</span>
              <span>TypeScript 7.0 + Vite 8.3</span>
              <span>Tailwind 4 + Zustand 5</span>
              <span>better-sqlite3 + TypeBox</span>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {t(
            'page.settings.about.license',
            'Education Advisor 内置 EAA Core (Rust) + DeepSeek Harness（dsh）+ 18 个教育 AI Agent，遵循 MIT 协议发布。',
          )}
        </p>
      </div>
    </Section>
  )
}
