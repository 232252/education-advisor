// =============================================================
// useMcpServers — McpTab 数据加载与动作 handlers
// 策略: 进入即加载 + 每 5s 粗轮询刷新连接状态;工具列表懒加载(选中且已连接时拉取)
// 状态与逻辑自 tabs/McpTab.tsx 逐字搬移,行为不变
// =============================================================

import type { McpServerConfig, McpServerStatus, McpTool } from '@shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useInterval } from '../../../hooks'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'

export function useMcpServers() {
  const { t } = useT()
  const [servers, setServers] = useState<McpServerStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [mcpEnabled, setMcpEnabled] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [toolsCache, setToolsCache] = useState<Record<string, McpTool[]>>({})
  const [toolsLoadingId, setToolsLoadingId] = useState<string | null>(null)
  // R1-7 / UI-4 修复: 记录每个 server 的 listTools 错误,失败时显式提示而非静默显示"无工具"
  const [toolsErrorMap, setToolsErrorMap] = useState<Record<string, string>>({})
  const [showForm, setShowForm] = useState(false)
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null)
  const [showPresets, setShowPresets] = useState(false)
  const [presetDraft, setPresetDraft] = useState<McpServerConfig | null>(null)
  const loadingRef = useRef(false)

  const checkMcpEnabled = useCallback(async () => {
    try {
      const settings = await getAPI().settings.get()
      setMcpEnabled(settings?.mcp?.enabled === true)
    } catch {
      setMcpEnabled(false)
    }
  }, [])

  const handleToggleMcp = async (enabled: boolean) => {
    try {
      const result = await getAPI().settings.set('mcp.enabled', enabled)
      if (result.success) {
        setMcpEnabled(enabled)
        toast.success(enabled ? t('toast.mcp.enabled') : t('toast.mcp.disabled'))
        if (enabled) {
          setLoading(true)
          // R3-4: 直接调用 loadServers(原 setTimeout 500ms 在快速切 tab 时可能命中已卸载组件)
          loadServers()
        } else {
          setServers([])
          setSelectedId(null)
          // R3-4: 禁用 MCP 时清空所有工具缓存/错误/代际,避免重新启用时显示陈旧数据
          setToolsCache({})
          setToolsErrorMap({})
          toolsGenRef.current = {}
        }
      } else {
        toast.error(t('toast.mcp.toggleFailed'))
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const loadServers = useCallback(async () => {
    if (document.visibilityState === 'hidden') {
      setLoading(false)
      return
    }
    if (loadingRef.current) return
    loadingRef.current = true
    try {
      const result = await getAPI().mcp.list()
      if (result.success) {
        setServers((previous) => {
          const unchanged =
            previous.length === result.servers.length &&
            previous.every((server, index) => {
              const next = result.servers[index]
              return (
                server.id === next.id &&
                server.name === next.name &&
                server.connected === next.connected &&
                server.toolCount === next.toolCount &&
                server.lastError === next.lastError &&
                server.transport === next.transport &&
                server.source === next.source &&
                server.enabled === next.enabled
              )
            })
          return unchanged ? previous : result.servers
        })
      } else if (result.error) {
        toast.error(result.error)
      }
    } catch (err) {
      console.error('[MCP] load failed:', err)
      toast.error(t('toast.mcp.loadFailed'))
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    checkMcpEnabled()
    loadServers()
  }, [checkMcpEnabled, loadServers])

  // 每 5s 轮询刷新连接状态(粗轮询,工具列表懒加载)
  useInterval(loadServers, mcpEnabled ? 5000 : null)

  const selected = servers.find((s) => s.id === selectedId) ?? null
  // R3-4 修复: per-server 请求代际,防止并发/过期 loadTools 的旧响应覆盖新结果。
  // 每次发起 loadTools 递增该 server 的代际;响应回来时若代际已变(被更新的请求取代),丢弃。
  const toolsGenRef = useRef<Record<string, number>>({})

  // 清理指定 server 的工具缓存 + 错误 + 代际(disconnect/delete/disable 时调用)
  const clearToolsState = useCallback((serverId: string) => {
    setToolsCache((prev) => {
      if (!prev[serverId]) return prev
      const next = { ...prev }
      delete next[serverId]
      return next
    })
    setToolsErrorMap((prev) => {
      if (!prev[serverId]) return prev
      const next = { ...prev }
      delete next[serverId]
      return next
    })
    delete toolsGenRef.current[serverId]
  }, [])

  // 拉取某 server 的工具列表(选中且已连接时)。
  // R1-7 / UI-4 修复: 失败时记录错误并 toast 提示,不再静默吞错让用户误以为"无工具"。
  // R3-4 修复: 代际防护,旧响应不覆盖新结果。
  const loadTools = useCallback(
    async (serverId: string) => {
      const gen = (toolsGenRef.current[serverId] ?? 0) + 1
      toolsGenRef.current[serverId] = gen
      setToolsLoadingId(serverId)
      try {
        const result = await getAPI().mcp.listTools(serverId)
        // 代际过期: 已被更新的请求/清理取代,丢弃本次响应
        if (toolsGenRef.current[serverId] !== gen) return
        if (result.success) {
          setToolsCache((prev) => ({ ...prev, [serverId]: result.tools }))
          setToolsErrorMap((prev) => {
            if (!prev[serverId]) return prev
            const next = { ...prev }
            delete next[serverId]
            return next
          })
        } else {
          const msg = result.error || t('toast.mcp.loadToolsFailed')
          setToolsErrorMap((prev) => ({ ...prev, [serverId]: msg }))
          console.error('[MCP] listTools returned failure:', msg)
        }
      } catch (err) {
        if (toolsGenRef.current[serverId] !== gen) return
        const msg = (err as Error).message
        setToolsErrorMap((prev) => ({ ...prev, [serverId]: msg }))
        console.error('[MCP] listTools failed:', err)
      } finally {
        if (toolsGenRef.current[serverId] === gen) {
          setToolsLoadingId(null)
        }
      }
    },
    [t],
  )

  useEffect(() => {
    if (selected?.connected && selectedId && !toolsCache[selectedId]) {
      loadTools(selectedId)
    }
  }, [selected, selectedId, toolsCache, loadTools])

  const handleTest = async (id: string) => {
    try {
      const result = await getAPI().mcp.test(id)
      if (result.success) {
        toast.success(t('toast.mcp.testOk').replace('{count}', String(result.toolCount)))
        await loadServers()
        await loadTools(id)
      } else {
        toast.error(result.error || t('toast.mcp.testFail'))
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleConnect = async (id: string) => {
    try {
      const result = await getAPI().mcp.connect(id)
      if (result.success) {
        toast.success(t('toast.mcp.connectSuccess'))
        await loadServers()
        await loadTools(id)
      } else {
        toast.error(result.error || t('toast.mcp.connectFailed'))
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  // R1-7 / UI-5 修复: 检查 result.success,失败时不清理缓存/不刷新,避免假性成功。
  // R3-4: 用 clearToolsState 统一清理(含代际),防止 disconnect 后 effect 重新触发 loadTools 还原错误。
  const handleDisconnect = async (id: string) => {
    try {
      const result = await getAPI().mcp.disconnect(id)
      if (result.success) {
        clearToolsState(id)
        await loadServers()
      } else {
        toast.error(result.error || t('toast.mcp.disconnectFailed'))
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    try {
      const result = await getAPI().mcp.update(id, { enabled })
      if (result.success) {
        toast.success(t('toast.mcp.updated'))
        // R3-4: 禁用时清理工具缓存(断开的 server 不应保留旧工具列表)
        if (!enabled) clearToolsState(id)
        await loadServers()
      } else {
        // R5-I18N-1 修复: 失败 fallback 不再用 "已更新" 文案,改用 toggleFailed
        toast.error(result.error || t('toast.mcp.toggleFailed'))
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const result = await getAPI().mcp.remove(id)
      if (result.success) {
        toast.success(t('toast.mcp.removed'))
        if (selectedId === id) setSelectedId(null)
        // R3-4: 删除时清理该 server 的工具缓存/错误/代际
        clearToolsState(id)
        await loadServers()
      } else {
        toast.error(result.error || t('toast.mcp.removed'))
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleEdit = async (id: string) => {
    // listServers 不返回完整 config(command/args/env 等)
    // 用已知字段(id/name/enabled/transport)预填,未知字段留空让用户补
    const s = servers.find((x) => x.id === id)
    if (!s) return
    setEditingServer({
      id: s.id,
      name: s.name,
      enabled: s.enabled,
      transport: s.transport,
    })
    setPresetDraft(null)
    setShowForm(true)
  }

  const handleFormSubmit = async (config: McpServerConfig) => {
    try {
      const isEdit = editingServer !== null
      const result = isEdit
        ? await getAPI().mcp.update(editingServer?.id, config)
        : await getAPI().mcp.add(config)
      if (result.success) {
        toast.success(isEdit ? t('toast.mcp.updated') : t('toast.mcp.added'))
        setShowForm(false)
        setEditingServer(null)
        setPresetDraft(null)
        await loadServers()
      } else {
        toast.error(result.error || t('toast.mcp.toggleFailed'))
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return {
    servers,
    loading,
    mcpEnabled,
    selectedId,
    setSelectedId,
    toolsCache,
    toolsLoadingId,
    toolsErrorMap,
    showForm,
    setShowForm,
    editingServer,
    setEditingServer,
    showPresets,
    setShowPresets,
    presetDraft,
    setPresetDraft,
    selected,
    loadTools,
    handleToggleMcp,
    handleTest,
    handleConnect,
    handleDisconnect,
    handleToggleEnabled,
    handleDelete,
    handleEdit,
    handleFormSubmit,
  }
}
