// =============================================================
// LocalModelsSection — 本地模型(Ollama)管理区 (编排层)
// 显示 Ollama 状态、推荐模型列表(一键下载)、已安装模型、下载进度。
// 放置在模型页顶部,独立于云端 provider 管理。
// 数据/动作: hooks/useLocalModels.ts
// UI 块: components/RecommendedModelCard / InstalledModelList
// =============================================================

import { useState } from 'react'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { InstalledModelList } from './components/InstalledModelList'
import { RecommendedModelCard } from './components/RecommendedModelCard'
import { useLocalModels } from './hooks/useLocalModels'
import { RECOMMENDED } from './lib/local-models'

export function LocalModelsSection() {
  const { t } = useT()
  const {
    installed,
    pulling,
    progress,
    serveRunning,
    available,
    handleStartServe,
    handlePull,
    handleDelete,
  } = useLocalModels()
  const [expandedManual, setExpandedManual] = useState<string | null>(null)

  return (
    <div className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-gray-800 dark:to-gray-800/50 border border-indigo-200 dark:border-white/[0.06] rounded-xl overflow-hidden mb-6">
      {/* 标题栏 */}
      <div className="px-5 py-4 border-b border-indigo-200 dark:border-white/[0.06]/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🖥️</span>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {t('page.models.local.title', '本地模型')}
          </h2>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            {t('page.models.local.ollamaDesc', 'Ollama · CPU 推理 · 免登录免费')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              serveRunning
                ? 'bg-emerald-400 animate-pulse'
                : available
                  ? 'bg-amber-400'
                  : 'bg-gray-400 dark:bg-gray-500'
            }`}
          />
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            {serveRunning
              ? t('page.models.local.running')
              : available
                ? t('page.models.local.installedNotRunning')
                : t('page.models.local.notInstalled')}
          </span>
          {serveRunning ? (
            <button
              type="button"
              onClick={() => getAPI().ollama.stopServe()}
              className="text-[10px] px-2 py-1 rounded-lg border border-gray-300 dark:border-white/[0.08] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors"
            >
              {t('page.models.local.stop')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartServe}
              disabled={!available}
              className="text-[10px] px-2 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 disabled:opacity-50 transition-colors"
            >
              {t('page.models.local.start')}
            </button>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* 未安装提示 */}
        {!available && (
          <div className="text-xs text-gray-500 dark:text-gray-400 bg-white/60 dark:bg-surface-elevated/40 rounded-lg p-3 leading-relaxed">
            <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('page.models.local.notDetected', '未检测到 Ollama')}
            </div>
            {t('page.models.local.installHint')}
            <ol className="list-decimal ml-4 mt-1 space-y-0.5">
              <li>
                {t('page.models.local.visit')}{' '}
                <a
                  href="https://ollama.com/download"
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-500 dark:text-indigo-400 underline"
                >
                  ollama.com/download
                </a>{' '}
                {t('page.models.local.downloadWin')}
              </li>
              <li>{t('page.models.local.hint', '安装后回到此页面,点击"启动"')}</li>
            </ol>
          </div>
        )}

        {/* 推荐模型 */}
        <div>
          <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
            {t('page.models.local.recommended')}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {RECOMMENDED.map((m) => (
              <RecommendedModelCard
                key={m.tag}
                model={m}
                installed={installed}
                pulling={pulling}
                progress={progress}
                serveRunning={serveRunning}
                expandedManual={expandedManual}
                onToggleExpandedManual={(tag) =>
                  setExpandedManual(expandedManual === tag ? null : tag)
                }
                onPull={handlePull}
              />
            ))}
          </div>
        </div>

        {/* 已安装模型 */}
        {serveRunning && installed.length > 0 && (
          <InstalledModelList installed={installed} onDelete={handleDelete} />
        )}

        {/* 说明 */}
        <div className="text-[10px] text-gray-400 dark:text-gray-500 italic">
          {t('page.models.local.footer')}
        </div>
      </div>
    </div>
  )
}
