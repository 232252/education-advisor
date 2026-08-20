// =============================================================
// 关于 Section — 应用版本/底层核心(EAA / Pi Agent / Pi-AI / PII Shield)/ 关键依赖
// 纯展示组件,无 state / callback
// =============================================================

import { useT } from '../../../i18n'
import { Section } from '../components'

export function AboutSection() {
  const { t } = useT()

  return (
    <Section title={t('settings.section.about')}>
      <div className="px-5 py-5 space-y-4">
        <div>
          <div className="text-base text-gray-800 dark:text-gray-100 font-semibold">
            Education Advisor{' '}
            <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
              v0.1.0-rc.1
            </span>
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
                  href="https://github.com/earendil-works/pi"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 font-medium"
                >
                  Pi Agent
                </a>
                <span className="text-gray-500 dark:text-gray-400 text-[11px]">
                  {' '}
                  {t('page.settings.about.core.piAgent', '— Agent 运行时 (vendor/pi-agent-core)')}
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
                  {t('page.settings.about.core.piAi', '— LLM 通信层 (vendor/pi-ai)')}
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
              <span>Electron 43.2 + React 19.2</span>
              <span>TypeScript 7.0 + Vite 8.1</span>
              <span>Tailwind 4 + Zustand 5</span>
              <span>better-sqlite3 + TypeBox</span>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {t(
            'page.settings.about.license',
            'Education Advisor 内置 EAA Core (Rust) + Pi Agent 运行时 + Pi-AI 通信层 + 18 个教育 AI Agent，遵循 MIT 协议发布。',
          )}
        </p>
      </div>
    </Section>
  )
}
