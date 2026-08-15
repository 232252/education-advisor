// =============================================================
// 配置 Tab — Agent 属性编辑（调用 agent:update）
// =============================================================

import type { AgentDetail } from '@shared/types'
import { useEffect, useRef, useState } from 'react'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle } from '../../../lib/ui-utils'
import type { AgentUpdatePatch } from '../types'

interface ConfigTabProps {
  detail: AgentDetail
  onUpdate: (id: string, patch: AgentUpdatePatch) => Promise<void>
}

export function ConfigTab({ detail, onUpdate }: ConfigTabProps) {
  const [name, setName] = useState(detail.name)
  const [description, setDescription] = useState(detail.description)
  const [modelTier, setModelTier] = useState<'high_quality' | 'low_cost'>(detail.modelTier)
  // R6-2: agent 级 MCP server 引用(多选)。detail.mcpServers 可能为 undefined。
  const [mcpServers, setMcpServers] = useState<string[]>(detail.mcpServers ?? [])
  // 可用的 MCP server 列表(从 mcp:list 拉取,供用户勾选)
  const [availableServers, setAvailableServers] = useState<{ id: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // 切换 agent 时（detail 引用变化）重置表单
  // 使用 ref 模式以避免 useExhaustiveDependencies: 仅当 detail 引用实际变化时才同步
  const prevDetailRef = useRef<AgentDetail>(detail)
  useEffect(() => {
    if (prevDetailRef.current !== detail) {
      prevDetailRef.current = detail
      setName(detail.name)
      setDescription(detail.description)
      setModelTier(detail.modelTier)
      setMcpServers(detail.mcpServers ?? [])
      setDirty(false)
    }
  }, [detail])

  // R6-2: 拉取可用 MCP server 列表(进入 config tab 时)。
  // 失败则空列表(只显示已选)。
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const result = await getAPI().mcp.list()
        if (!cancelled && result?.success && Array.isArray(result.servers)) {
          setAvailableServers(result.servers.map((s) => ({ id: s.id, name: s.name })))
        }
      } catch {
        // MCP 未启用或 IPC 不可用,availableServers 保持空,用户仍可看到已选 id
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onUpdate(detail.id, { name, description, modelTier, mcpServers })
      setDirty(false)
    } catch {
      // updateAgent 内部已 toast
    } finally {
      setSaving(false)
    }
  }

  const markDirty = () => setDirty(true)

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-white/[0.06]">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {dirty ? '未保存' : '已保存'}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className={btnStyle('primary')}
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Agent 名称 */}
        <div>
          <label
            htmlFor="agent-config-name"
            className="text-xs text-gray-500 dark:text-gray-400 font-medium block mb-1"
          >
            名称
          </label>
          <input
            id="agent-config-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              markDirty()
            }}
            className="w-full bg-white border border-gray-300 dark:bg-surface-elevated dark:border-white/[0.08] rounded-lg px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
          />
        </div>

        {/* 描述 */}
        <div>
          <label
            htmlFor="agent-config-description"
            className="text-xs text-gray-500 dark:text-gray-400 font-medium block mb-1"
          >
            描述
          </label>
          <textarea
            id="agent-config-description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              markDirty()
            }}
            rows={3}
            className="w-full bg-white border border-gray-300 dark:bg-surface-elevated dark:border-white/[0.08] rounded-lg px-3 py-2 text-sm resize-none
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
          />
        </div>

        {/* 模型层级 */}
        <div>
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium block mb-1">
            模型层级
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setModelTier('low_cost')
                markDirty()
              }}
              className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors border ${
                modelTier === 'low_cost'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-surface-elevated text-gray-600 dark:text-gray-300 border-gray-300 dark:border-white/[0.08] hover:border-blue-400'
              }`}
            >
              低成本
            </button>
            <button
              type="button"
              onClick={() => {
                setModelTier('high_quality')
                markDirty()
              }}
              className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors border ${
                modelTier === 'high_quality'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-surface-elevated text-gray-600 dark:text-gray-300 border-gray-300 dark:border-white/[0.08] hover:border-blue-400'
              }`}
            >
              高质量
            </button>
          </div>
        </div>

        {/* MCP server 选择 */}
        <div>
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium block mb-1">
            MCP 服务器
          </span>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2">
            勾选后,该 Agent 运行时可使用这些 MCP 服务器提供的工具。在「技能 → MCP 服务器」管理。
          </p>
          {availableServers.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">
              {mcpServers.length === 0
                ? '暂无可用的 MCP 服务器(请在技能页添加,或未启用 MCP 功能)'
                : `已选: ${mcpServers.join(', ')} (服务列表加载中或 MCP 未启用)`}
            </p>
          ) : (
            <div className="space-y-1">
              {availableServers.map((srv) => {
                const checked = mcpServers.includes(srv.id)
                return (
                  <label
                    key={srv.id}
                    className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setMcpServers((prev) =>
                          e.target.checked ? [...prev, srv.id] : prev.filter((id) => id !== srv.id),
                        )
                        markDirty()
                      }}
                    />
                    <span className="font-mono text-xs text-blue-500">{srv.id}</span>
                    <span className="text-gray-400 dark:text-gray-500">— {srv.name}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        {/* 只读信息 */}
        <div className="border-t border-gray-200 dark:border-white/[0.06] pt-4 space-y-2">
          <h4 className="text-xs text-gray-400 dark:text-gray-500 font-medium">只读信息</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="text-gray-500 dark:text-gray-400">ID</div>
            <div className="font-mono text-gray-700 dark:text-gray-300">{detail.id}</div>
            <div className="text-gray-500 dark:text-gray-400">角色</div>
            <div className="text-gray-700 dark:text-gray-300">{detail.role}</div>
            <div className="text-gray-500 dark:text-gray-400">能力</div>
            <div className="text-gray-700 dark:text-gray-300">
              {detail.capabilities.join(', ') || '无'}
            </div>
            <div className="text-gray-500 dark:text-gray-400">定时</div>
            <div className="font-mono text-gray-700 dark:text-gray-300">
              {detail.schedule.join(', ') || '无'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
