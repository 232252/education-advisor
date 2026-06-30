// =============================================================
// 隐私控制中心页面
// 安全模型:
//   - 密码仅在 init/load 时通过 IPC 传输一次,主进程在内存中保留
//   - 渲染进程随后清空自身密码状态,避免长期持有
//   - 后续操作(list/anonymize/...)不传密码,使用主进程内存中的缓存
//   - 提供"锁定"按钮,清空主进程内存中的密码
// =============================================================

import { useEffect, useState } from 'react'
import { useT } from '../../i18n'
import { getAPI, getErrorMessage } from '../../lib/ipc-client'
import { toast } from '../../stores/toastStore'

export function PrivacyPage() {
  const { t } = useT()
  const [password, setPassword] = useState('')
  const [mappings, setMappings] = useState<
    Array<{ entityType: string; pseudonym: string; realName: string }>
  >([])
  const [previewInput, setPreviewInput] = useState('')
  const [previewResult, setPreviewResult] = useState('')
  const [isLoaded, setIsLoaded] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [initPassword, setInitPassword] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  // 添加实体表单状态
  const [showAddForm, setShowAddForm] = useState(false)
  const [newEntityType, setNewEntityType] = useState('person')
  const [newEntityName, setNewEntityName] = useState('')
  const [adding, setAdding] = useState(false)

  // 查询主进程隐私引擎状态(是否已在内存中加载密码)
  useEffect(() => {
    let cancelled = false
    const checkStatus = async () => {
      try {
        const result = await getAPI().privacy.status()
        if (!cancelled) {
          setUnlocked(result.unlocked)
          if (result.unlocked) {
            // 主进程已持有密码,标记为已初始化
            setIsInitialized(true)
          }
        }
      } catch (err) {
        console.warn('[Privacy] Status check failed:', err)
      }
    }
    checkStatus()
    return () => {
      cancelled = true
    }
  }, [])

  const handleInit = async () => {
    if (!initPassword || initPassword.length < 4) {
      toast.warning('密码至少 4 位')
      return
    }
    try {
      const result = await getAPI().privacy.init(initPassword, true)
      if (result.success) {
        setIsInitialized(true)
        setUnlocked(true)
        // 立即清空渲染进程中的密码状态(主进程已缓存)
        setInitPassword('')
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
      // C-1 修复: 移除自动 init 回退 - 错误密码触发的 init 会覆盖已有隐私库,导致数据永久丢失
      // 现在 load 失败时只提示错误,让用户主动决定是否重新初始化
      const result = await getAPI().privacy.load(password)
      if (!result.success) {
        toast.error(`密码错误或加载失败: ${getErrorMessage(result)}`)
        return
      }
      setUnlocked(true)
      setIsInitialized(true)
      // 立即清空渲染进程中的密码状态(主进程已缓存)
      setPassword('')
      // 后续 list 调用不传密码,使用主进程内存中的缓存
      const listResult = await getAPI().privacy.list()
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

  // 锁定隐私引擎(清空主进程内存中的密码)
  const handleLock = async () => {
    try {
      await getAPI().privacy.lock()
      setUnlocked(false)
      setIsLoaded(false)
      setIsInitialized(false)
      setMappings([])
      toast.success('已锁定隐私引擎')
    } catch (err) {
      console.error('[Privacy] Lock failed:', err)
      toast.error('锁定失败')
    }
  }

  const handlePreview = async () => {
    if (!previewInput) return
    try {
      const result = await getAPI().privacy.dryrun(previewInput)
      if (result.success) {
        setPreviewResult(JSON.stringify(result.data, null, 2))
      } else {
        // H-10 修复: result.success === false 时也要给用户反馈
        const errMsg = (result as { error?: string }).error || '脱敏预览失败(未知原因)'
        toast.error(errMsg)
        setPreviewResult(`错误: ${errMsg}`)
      }
    } catch (err) {
      console.error('[Privacy] Preview failed:', err)
      toast.error('脱敏预览失败')
    }
  }

  const handleBackup = async () => {
    try {
      // C-2 修复: saveDialog 返回 {canceled, filePath} 对象,而非字符串
      // 之前把对象当作字符串传递,且 !filePath 永远为 false(对象 truthy)
      const dialogResult = (await getAPI().sys.saveDialog({
        title: '备份隐私映射表',
        defaultPath: 'privacy-backup.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })) as { canceled: boolean; filePath?: string }
      const filePath = dialogResult?.filePath
      if (!filePath) return
      const result = await getAPI().privacy.backup(filePath)
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

  // 添加隐私实体 — 调用主进程 IPC_PRIVACY_ADD,成功后刷新映射表
  const handleAddEntity = async () => {
    const name = newEntityName.trim()
    if (!name) {
      toast.warning('请输入实体名称')
      return
    }
    // CONCERN 修复 + MEDIUM 修复: 前端重复实体预检,避免无意义的 IPC 调用
    // MEDIUM 修复: email/person 类型大小写不敏感比较(ZHANG SAN vs zhang san 视为重复)
    // 其他类型(student_id/id_card/phone/place/org)按原值比较,避免误判
    const CASE_INSENSITIVE_TYPES = new Set(['person', 'email'])
    const shouldIgnoreCase = CASE_INSENSITIVE_TYPES.has(newEntityType)
    const normalizedNewName = shouldIgnoreCase ? name.toLowerCase() : name
    const isDuplicate = mappings.some((m) => {
      if (m.entityType !== newEntityType) return false
      const existingName = shouldIgnoreCase ? m.realName.toLowerCase() : m.realName
      return existingName === normalizedNewName
    })
    if (isDuplicate) {
      toast.warning(`该实体已存在: ${newEntityType} / ${name}`)
      return
    }
    setAdding(true)
    try {
      const result = await getAPI().privacy.add(newEntityType, name)
      if (result.success) {
        toast.success('实体添加成功,可继续添加')
        setNewEntityName('')
        setNewEntityType('person') // CONCERN 修复: 成功后重置类型为默认值
        // LOW 修复: 不关闭表单,允许用户连续添加多个实体。
        // 用户完成添加后可点击"取消"按钮关闭表单。
        // 刷新映射表(复用 handleLoad 中的防御性解析逻辑)
        const listResult = await getAPI().privacy.list()
        if (listResult.success) {
          let data = listResult.data
          if (typeof data === 'string') {
            try {
              data = JSON.parse(data)
            } catch {
              data = []
            }
          }
          setMappings(Array.isArray(data) ? data : [])
        }
      } else {
        toast.error(`添加失败: ${getErrorMessage(result)}`)
      }
    } catch (err) {
      console.error('[Privacy] Add entity failed:', err)
      toast.error('添加实体失败')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('page.privacy.title')}</h1>
        {unlocked && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-500 dark:text-green-400">● 已解锁</span>
            <button
              type="button"
              onClick={handleLock}
              className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              🔒 锁定
            </button>
          </div>
        )}
      </div>

      {/* 初始化引导（首次使用） */}
      {!isInitialized && (
        <div className="bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800 rounded-xl p-5">
          <h2 className="font-semibold mb-2">{t('page.privacy.init.title')}</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            设置一个加密密码来保护学生隐私数据。初始化后，所有敏感信息将自动脱敏处理。
            密码仅在本次传输,主进程在内存中保留,关闭软件或点击"锁定"后将清空。
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

      {/* 添加实体 */}
      {isLoaded && (
        <div className="bg-gray-50 border border-gray-200 dark:bg-gray-800 dark:border-gray-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">添加实体</h2>
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              {showAddForm ? '取消' : '+ 添加实体'}
            </button>
          </div>
          {showAddForm && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="sm:w-52">
                <label
                  htmlFor="new-entity-type"
                  className="block text-xs text-gray-500 dark:text-gray-400 mb-1"
                >
                  实体类型
                </label>
                <select
                  id="new-entity-type"
                  value={newEntityType}
                  onChange={(e) => setNewEntityType(e.target.value)}
                  className="w-full bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 rounded-lg px-3 py-2 text-sm
                             focus:outline-none focus:border-blue-500"
                >
                  <option value="person">人物 (学生/教师/家长)</option>
                  <option value="student_id">学号</option>
                  <option value="id_card">身份证号</option>
                  <option value="phone">电话</option>
                  <option value="email">邮箱</option>
                  <option value="place">地点</option>
                  <option value="org">组织 (学校/班级)</option>
                </select>
              </div>
              <div className="flex-1">
                <label
                  htmlFor="new-entity-name"
                  className="block text-xs text-gray-500 dark:text-gray-400 mb-1"
                >
                  实体名称 (必填)
                </label>
                <input
                  id="new-entity-name"
                  type="text"
                  value={newEntityName}
                  onChange={(e) => setNewEntityName(e.target.value)}
                  placeholder="输入实体名称 (如:张三)..."
                  className="w-full bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 rounded-lg px-3 py-2 text-sm
                             focus:outline-none focus:border-blue-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !adding) handleAddEntity()
                  }}
                />
              </div>
              <button
                type="button"
                onClick={handleAddEntity}
                disabled={adding || !newEntityName.trim()}
                className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg text-sm transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adding ? '添加中...' : '确认添加'}
              </button>
            </div>
          )}
        </div>
      )}

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
