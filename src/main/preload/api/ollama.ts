// =============================================================
// Preload API — 本地模型 (Ollama) 域
// =============================================================

import type { OllamaAPI } from '@shared/api/ollama'
import * as IPC from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'
import { subscribe } from './subscribe'

export const ollamaApi: OllamaAPI = {
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
  onPullProgress: (callback) => subscribe(IPC.IPC_OLLAMA_PULL_PROGRESS, callback),
}
