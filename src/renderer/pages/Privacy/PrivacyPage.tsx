// =============================================================
// 隐私控制中心页面 (编排层)
// 安全模型:
//   - 密码仅在 init/load 时通过 IPC 传输一次,主进程在内存中保留
//   - 渲染进程随后清空自身密码状态,避免长期持有
//   - 后续操作(list/anonymize/...)不传密码,使用主进程内存中的缓存
//   - 提供"锁定"按钮,清空主进程内存中的密码
// 数据/动作: hooks/usePrivacyData.ts
// UI 块: components/PrivacyInitCard / PrivacyLoadCard / AddEntityCard / MappingTableCard / PrivacyPreviewCard
// =============================================================

import { PageHeader } from '../../components/PageHeader'
import { useT } from '../../i18n'
import { btnStyle } from '../../lib/ui-utils'
import { AddEntityCard } from './components/AddEntityCard'
import { MappingTableCard } from './components/MappingTableCard'
import { PrivacyInitCard } from './components/PrivacyInitCard'
import { PrivacyLoadCard } from './components/PrivacyLoadCard'
import { PrivacyPreviewCard } from './components/PrivacyPreviewCard'
import { usePrivacyData } from './hooks/usePrivacyData'

export function PrivacyPage() {
  const { t } = useT()
  const {
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
  } = usePrivacyData()

  return (
    <div className="h-full overflow-y-auto animate-fade-in">
      <PageHeader
        title={t('page.privacy.title')}
        size="md"
        actions={
          unlocked ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-green-500 dark:text-green-400">● 已解锁</span>
              <button
                type="button"
                onClick={handleLock}
                aria-label="锁定隐私引擎"
                className={btnStyle('secondary')}
              >
                🔒 锁定
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="p-6 space-y-6">
        {/* 初始化引导（首次使用） */}
        {!isInitialized && (
          <PrivacyInitCard
            initPassword={initPassword}
            setInitPassword={setInitPassword}
            onInit={handleInit}
          />
        )}

        {/* 密码与加载 */}
        <PrivacyLoadCard
          password={password}
          setPassword={setPassword}
          onLoad={handleLoad}
          onBackup={handleBackup}
          isLoaded={isLoaded}
          mappingsCount={mappings.length}
        />

        {/* 添加实体 */}
        {isLoaded && (
          <AddEntityCard
            showAddForm={showAddForm}
            onToggleForm={() => setShowAddForm(!showAddForm)}
            newEntityType={newEntityType}
            setNewEntityType={setNewEntityType}
            newEntityName={newEntityName}
            setNewEntityName={setNewEntityName}
            adding={adding}
            onAddEntity={handleAddEntity}
          />
        )}

        {/* 映射表 */}
        {isLoaded && mappings.length > 0 && <MappingTableCard mappings={mappings} />}

        {/* 脱敏预览 */}
        <PrivacyPreviewCard
          previewInput={previewInput}
          setPreviewInput={setPreviewInput}
          onPreview={handlePreview}
          previewResult={previewResult}
        />
      </div>
    </div>
  )
}
