// =============================================================
// IPC API 类型 — office 转 PDF 组件（libreoffice-kit 按需补装）
// =============================================================

export interface OfficeKitStatus {
  /** ready 已就绪 / installing 下载解压中 / missing 待安装 / unknown 清单缺失 */
  state: 'ready' | 'installing' | 'missing' | 'unknown'
  /** ready 时组件来源：bundled 随包 / downloaded 按需下载 */
  source?: 'bundled' | 'downloaded'
  /** installing/unknown 时的状态说明 */
  message?: string
}

export interface OfficeKitAPI {
  /** 只读状态，不触发安装 */
  status: () => Promise<OfficeKitStatus>
  /** 下载并安装（幂等；已在途时复用同一任务） */
  install: () => Promise<OfficeKitStatus>
}
