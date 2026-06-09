// =============================================================
// 隐私控制中心页面
// =============================================================

import { useState } from 'react'
import { useT } from '../../i18n'
import { getAPI, getErrorMessage } from '../../lib/ipc-client'
import { toast } from '../../stores/toastStore'

export function PrivacyPage() {
  const [password, setPassword] = useState('')
  const { t } = useT()
  const [mappings, setMappings] = useState<
    Array<{ entityType: string; pseudonym: string; realName: string }>
  >([])
  const [previewInput, setPreviewInput] = useState('')
  const [previewResult, setPreviewResult] = useState('')
  const [isLoaded, setIsLoaded] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [initPassword, setInitPassword] = useState('')
  const [_showInit, _setShowInit] = useState(false)

  const handleInit = async () => {
    if (!initPassword || initPassword.length < 4) {
      toast.warning('密码至少 4 位')
      return
    }
    try {
      const result = await getAPI().privacy.init(initPassword, true)
      if (result.success) {
        setIsInitialized(true)
        setPassword(initPassword)
        toast.success(t('status.success'))
      } else {
        toast.error(`初始化失败: ${getErrorMessage(result)}`)
      }
    } catch (err) {
      console.error('[Privacy] Init failed:', err)
      toast.error(t('status.failed'))
    }
  }

  const handleLoad = async () => {
    if (!password) return
    try {
      // 尝试 load，如果失败则自动 init
      let result = await getAPI().privacy.load(password)
      if (!result.success) {
        // 可能是首次使用，尝试初始化
        result = await getAPI().privacy.init(password, true)
        if (result.success) {
          setIsInitialized(true)
        } else {
          toast.error(`加载失败: ${getErrorMessage(result)}`)
          return
        }
      }
      setIsInitialized(true)
      const listResult = await getAPI().privacy.list(password)
      if (listResult.success) {
        // 防御性校验：确保 data 是数组（bridge 可能返回字符串）
        let data = listResult.data
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data)
          } catch {
            data = []
          }
        }
        setMappings(Array.isArray(data) ? data : [])
        setIsLoaded(true)
      }
    } catch (err) {
      console.error('[Privacy] Failed to load:', err)
      toast.error('加载加密映射表失败')
    }
  }

  const handlePreview = async () => {
    if (!previewInput) return
    try {
      const result = await getAPI().privacy.dryrun(previewInput)
      if (result.success) {
        setPreviewResult(JSON.stringify(result.data, null, 2))
      }
    } catch (err) {
      console.error('[Privacy] Preview failed:', err)
      toast.error('脱敏预览失败')
    }
  }

  const handleBackup = async () => {
    try {
      const filePath = await getAPI().sys.saveDialog({
        title: '备份隐私映射表',
        defaultPath: 'privacy-backup.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (!filePath) return
      const result = await getAPI().privacy.backup(filePath as string)
      if (result.success) {
        toast.success('备份成功')
      } else {
        toast.error(`备份失败: ${getErrorMessage(result)}`)
      }
    } catch (err) {
      console.error('[Privacy] Backup failed:', err)
      toast.error('备份失败')
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">{t('page.privacy.title')}</h1>

      {/* 初始化引导（首次使用） */}
      {!isInitialized && (
        <div className="bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800 rounded-xl p-5">
          <h2 className="font-semibold mb-2">{t('page.privacy.init.title')}</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            设置一个加密密码来保护学生隐私数据。初始化后，所有敏感信息将自动脱敏处理。
          </p>
          <div className="flex gap-3 items-center">
            <input
              type="password"
              value={initPassword}
              onChange={(e) => setInitPassword(e.target.value)}
              placeholder="设置隐私密码（至少 4 位）..."
              className="flex-1 bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:border-blue-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleInit()
              }}
            />
            <button
              type="button"
              onClick={handleInit}
              disabled={initPassword.length < 4}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              初始化
            </button>
          </div>
        </div>
      )}

      {/* 密码与加载 */}
      <div className="bg-gray-50 border border-gray-200 dark:bg-gray-800 dark:border-gray-700 rounded-xl p-5">
        <h2 className="font-semibold mb-3">加密映射表</h2>
        <div className="flex gap-3 items-center">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="输入隐私密码..."
            className="flex-1 bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={handleLoad}
            className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm transition-colors"
          >
            加载映射表
          </button>
          <button
            type="button"
            onClick={handleBackup}
            disabled={!isLoaded}
            className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            备份
          </button>
        </div>
        {isLoaded && (
          <div className="mt-3 text-sm text-green-500 dark:text-green-400">
            已加载 {mappings.length} 条映射记录
          </div>
        )}
      </div>

      {/* 映射表 */}
      {isLoaded && mappings.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 dark:bg-gray-800 dark:border-gray-700 rounded-xl p-5">
          <h2 className="font-semibold mb-3">映射表</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                <th className="text-left py-2 px-3">类型</th>
                <th className="text-left py-2 px-3">化名</th>
                <th className="text-left py-2 px-3">真名</th>
              </tr>
            </thead>
            <tbody>
              {mappings.slice(0, 50).map((m) => (
                // P2-7: 组合 stable key(entityType + pseudonym)
                <tr
                  key={`${m.entityType}-${m.pseudonym}`}
                  className="border-b border-gray-100 dark:border-gray-800"
                >
                  <td className="py-2 px-3 text-gray-500 dark:text-gray-400">{m.entityType}</td>
                  <td className="py-2 px-3 font-mono text-blue-500 dark:text-blue-400">
                    {m.pseudonym}
                  </td>
                  <td className="py-2 px-3">{m.realName}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {mappings.length > 50 && (
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              显示前 50 条，共 {mappings.length} 条
            </div>
          )}
        </div>
      )}

      {/* 脱敏预览 */}
      <div className="bg-gray-50 border border-gray-200 dark:bg-gray-800 dark:border-gray-700 rounded-xl p-5">
        <h2 className="font-semibold mb-3">脱敏预览</h2>
        <textarea
          value={previewInput}
          onChange={(e) => setPreviewInput(e.target.value)}
          placeholder="输入包含学生姓名的文本，查看脱敏效果..."
          rows={3}
          className="w-full bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 rounded-lg px-3 py-2 text-sm
                     focus:outline-none focus:border-blue-500 resize-none mb-3"
        />
        <button
          type="button"
          onClick={handlePreview}
          className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg text-sm transition-colors"
        >
          测试脱敏
        </button>
        {previewResult && (
          <pre className="mt-3 bg-gray-100 dark:bg-gray-900 rounded-lg p-3 text-sm font-mono text-gray-600 dark:text-gray-300 overflow-x-auto">
            {previewResult}
          </pre>
        )}
      </div>
    </div>
  )
}
