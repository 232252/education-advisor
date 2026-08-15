// =============================================================
// McpTab — MCP 服务器管理 Tab(编排层)
// 左列表 + 右详情;弹窗: McpServerForm(新增/编辑)、PresetTemplates(模板)
// 数据/动作: hooks/useMcpServers.ts
// UI 块: components/McpEnabledBanner / McpServerList
// =============================================================

import { Plug } from 'lucide-react'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import { McpEnabledBanner } from '../components/McpEnabledBanner'
import { McpServerCard } from '../components/McpServerCard'
import { McpServerForm } from '../components/McpServerForm'
import { McpServerList } from '../components/McpServerList'
import { PresetTemplates } from '../components/PresetTemplates'
import { useMcpServers } from '../hooks/useMcpServers'

export function McpTab() {
  const { t } = useT()
  const {
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
  } = useMcpServers()

  if (loading) {
    return <div className="p-4 text-gray-500">{t('common.loading')}</div>
  }

  return (
    <section className="h-full flex flex-col">
      {/* MCP 功能开关横幅 */}
      <McpEnabledBanner enabled={mcpEnabled} onToggle={handleToggleMcp} />

      {/* MCP 未启用时显示提示 */}
      {!mcpEnabled ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <EmptyState
            icon={<Plug className="h-6 w-6" />}
            title={t('page.mcp.banner.disabled')}
            description={t('page.mcp.empty.hint')}
          />
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* 左侧服务器列表 */}
          <McpServerList
            servers={servers}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAdd={() => {
              setEditingServer(null)
              setPresetDraft(null)
              setShowForm(true)
            }}
            onFromTemplate={() => setShowPresets(true)}
          />

          {/* 右侧详情 */}
          <div className="flex-1 overflow-auto p-4">
            {selected ? (
              <McpServerCard
                server={selected}
                tools={toolsCache[selected.id] ?? []}
                toolsLoading={toolsLoadingId === selected.id}
                toolsError={toolsErrorMap[selected.id]}
                onReloadTools={() => loadTools(selected.id)}
                onTest={() => handleTest(selected.id)}
                onConnect={() => handleConnect(selected.id)}
                onDisconnect={() => handleDisconnect(selected.id)}
                onEdit={() => handleEdit(selected.id)}
                onDelete={() => handleDelete(selected.id)}
                onToggleEnabled={(enabled) => handleToggleEnabled(selected.id, enabled)}
              />
            ) : (
              <EmptyState
                icon={<Plug className="h-6 w-6" />}
                title={t('page.mcp.empty.title')}
                description={t('page.mcp.empty.hint')}
              />
            )}
          </div>
        </div>
      )}

      {/* 新增/编辑表单弹窗 */}
      {showForm && (
        <McpServerForm
          initial={editingServer ?? presetDraft}
          mode={editingServer ? 'edit' : 'add'}
          onSubmit={handleFormSubmit}
          onCancel={() => {
            setShowForm(false)
            setEditingServer(null)
            setPresetDraft(null)
          }}
        />
      )}

      {/* 预设模板弹窗 */}
      {showPresets && (
        <PresetTemplates
          onSelect={(config) => {
            setShowPresets(false)
            setEditingServer(null)
            setPresetDraft(config)
            setShowForm(true)
          }}
          onCancel={() => setShowPresets(false)}
        />
      )}
    </section>
  )
}
