// =============================================================
// usePrivacyData — 隐私控制中心数据加载与动作 handlers
// 安全模型:
//   - 密码仅在 init/load 时通过 IPC 传输一次,主进程在内存中保留
//   - 渲染进程随后清空自身密码状态,避免长期持有
//   - 后续操作(list/anonymize/...)不传密码,使用主进程内存中的缓存
// 状态与逻辑自 PrivacyPage.tsx 逐字搬移,行为不变
// =============================================================

import { useEffect, useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI, getErrorMessage } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'
import {
  isDuplicateEntity,
  type PrivacyMapping,
  parsePrivacyMappings,
} from '../lib/privacy-mappings'

export function usePrivacyData() {
  const { t } = useT()
  const [password, setPassword] = useState('')
  const [mappings, setMappings] = useState<PrivacyMapping[]>([])
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
      toast.warning(t('toast.privacy.passwordTooShort'))
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
        setMappings(parsePrivacyMappings(listResult.data))
        setIsLoaded(true)
      }
    } catch (err) {
      console.error('[Privacy] Failed to load:', err)
      toast.error(t('toast.privacy.loadMapFailed'))
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
      toast.success(t('toast.privacy.locked'))
    } catch (err) {
      console.error('[Privacy] Lock failed:', err)
      toast.error(t('toast.privacy.lockFailed'))
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
      toast.error(t('toast.privacy.previewFailed'))
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
        toast.success(t('toast.privacy.backupSuccess'))
      } else {
        toast.error(`备份失败: ${getErrorMessage(result)}`)
      }
    } catch (err) {
      console.error('[Privacy] Backup failed:', err)
      toast.error(t('toast.privacy.backupFailed'))
    }
  }

  // 添加隐私实体 — 调用主进程 IPC_PRIVACY_ADD,成功后刷新映射表
  const handleAddEntity = async () => {
    const name = newEntityName.trim()
    if (!name) {
      toast.warning(t('toast.privacy.enterEntityName'))
      return
    }
    if (isDuplicateEntity(mappings, newEntityType, name)) {
      toast.warning(`该实体已存在: ${newEntityType} / ${name}`)
      return
    }
    setAdding(true)
    try {
      const result = await getAPI().privacy.add(newEntityType, name)
      if (result.success) {
        toast.success(t('toast.privacy.entityAdded'))
        setNewEntityName('')
        setNewEntityType('person') // CONCERN 修复: 成功后重置类型为默认值
        // LOW 修复: 不关闭表单,允许用户连续添加多个实体。
        // 用户完成添加后可点击"取消"按钮关闭表单。
        // 刷新映射表(复用防御性解析逻辑)
        const listResult = await getAPI().privacy.list()
        if (listResult.success) {
          setMappings(parsePrivacyMappings(listResult.data))
        }
      } else {
        toast.error(`添加失败: ${getErrorMessage(result)}`)
      }
    } catch (err) {
      console.error('[Privacy] Add entity failed:', err)
      toast.error(t('toast.privacy.addEntityFailed'))
    } finally {
      setAdding(false)
    }
  }

  return {
    password,
    setPassword,
    mappings,
    previewInput,
    setPreviewInput,
    previewResult,
    isLoaded,
    isInitialized,
    initPassword,
    setInitPassword,
    unlocked,
    showAddForm,
    setShowAddForm,
    newEntityType,
    setNewEntityType,
    newEntityName,
    setNewEntityName,
    adding,
    handleInit,
    handleLoad,
    handleLock,
    handlePreview,
    handleBackup,
    handleAddEntity,
  }
}
