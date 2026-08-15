// =============================================================
// Preload API — 本地模型 (Ollama) 域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'

export const ollamaApi = {
  // [r] 检测 ollama 是否可用
  detect: () => ipcRenderer.invoke(IPC.IPC_OLLAMA_DETECT),
  // [w] 启动 ollama serve
  startServe: () => ipcRenderer.invoke(IPC.IPC_OLLAMA_START_SERVE),
  // [w] 停止 ollama serve
  stopServe: () => ipcRenderer.invoke(IPC.IPC_OLLAMA_STOP_SERVE),
  // [r] 列出已安装模型
  listModels: () => ipcRenderer.invoke(IPC.IPC_OLLAMA_LIST_MODELS),
  // [w] 下载模型(进度通过 onPullProgress 推送)
  pullModel: (modelName: string) => ipcRenderer.invoke(IPC.IPC_OLLAMA_PULL_MODEL, modelName),
  // [w] 删除模型
  deleteModel: (modelName: string) => ipcRenderer.invoke(IPC.IPC_OLLAMA_DELETE_MODEL, modelName),
  // [r] 订阅下载进度(返回取消订阅函数)
  onPullProgress: (callback: (info: unknown) => void) => {
    const listener = (_e: unknown, info: unknown) => callback(info)
    ipcRenderer.on(IPC.IPC_OLLAMA_PULL_PROGRESS, listener)
    return () => ipcRenderer.removeListener(IPC.IPC_OLLAMA_PULL_PROGRESS, listener)
  },
}
