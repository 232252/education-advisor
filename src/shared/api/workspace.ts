// =============================================================
// IPC API 类型 — 会话工作目录 (window.api.workspace)
// =============================================================

export interface WorkspaceFileEntry {
  /** 相对会话目录的路径（正斜杠） */
  path: string
  size: number
}

export interface WorkspaceAPI {
  /** 列出会话产出文件 */
  listFiles: (
    sessionId: string,
  ) => Promise<{ success: boolean; files: WorkspaceFileEntry[]; error?: string }>
  /** 另存为（教师选路径）；取消返回 canceled */
  saveAs: (
    sessionId: string,
    relPath: string,
  ) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>
}
