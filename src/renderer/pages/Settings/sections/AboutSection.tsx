// =============================================================
// 关于 Section — 应用版本/底层核心(EAA / Pi Agent / Pi-AI / PII Shield)/ 关键依赖
// 纯展示组件,无 state / callback
// 注: 保留 Electron 项目特定的版本号与依赖信息(不采用 Tauri 版本的文案)
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
            <span className="text-sm font-normal text-gray-500 dark:text-gray-400">v0.1.0</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
            Education Advisor — Pi Agent + Education Advisor AI
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 dark:bg-[#161920] rounded-lg p-3">
            <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 font-medium">
              底层核心
            </div>
            <div className="space-y-1.5 text-xs">
              <div>
                <span className="text-blue-500 dark:text-blue-400 font-medium">EAA Core</span>
                <span className="text-gray-500 dark:text-gray-400 text-[11px]">
                  {' '}
                  — Rust 操行评分/事件/隐私引擎, 22 子命令
                </span>
              </div>
              <div>
                <span className="text-blue-500 dark:text-blue-400 font-medium">17 教育 Agent</span>
                <span className="text-gray-500 dark:text-gray-400 text-[11px]">
                  {' '}
                  — 参谋/督导/辅导员/心理/纪律/班务等多智能体
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
                  — Agent 运行时 (packages/agent)
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
                  — LLM 通信层 (packages/ai)
                </span>
              </div>
              <div>
                <span className="text-blue-500 dark:text-blue-400 font-medium">PII Shield</span>
                <span className="text-gray-500 dark:text-gray-400 text-[11px]">
                  {' '}
                  — 隐私脱敏加密引擎
                </span>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-[#161920] rounded-lg p-3">
            <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 font-medium">
              关键依赖
            </div>
            <div className="grid grid-cols-1 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400">
              <span>Electron 33.2 + React 18.3</span>
              <span>TypeScript 5.7 + Vite 6</span>
              <span>Tailwind 3 + Zustand 5</span>
              <span>better-sqlite3 + TypeBox</span>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          Education Advisor 内置 EAA Core (Rust) + Pi Agent 运行时 + Pi-AI 通信层 + 17 个教育 AI
          Agent，遵循 MIT 协议发布。
        </p>

        <div className="pt-3 border-t border-gray-200 dark:border-white/[0.06]/60">
          <div className="text-[10px] text-gray-400 dark:text-gray-500 italic leading-relaxed">
            本设置页面在 T1 (2026-06-05) 经过整改 — 删除了 5
            个无价值模块(模型/隐私/高级/快捷键/匿名上报)与顶部组织说明文字, 保留通用/对话/飞书 3
            个核心 section。新增「关于」模块展示开源信息。
          </div>
        </div>
      </div>
    </Section>
  )
}
