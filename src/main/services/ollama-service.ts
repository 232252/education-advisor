// =============================================================
// OllamaService — 本地 LLM 运行时管理 入口
//
// 管理打包/系统安装的 ollama.exe 生命周期:
//   - 检测 ollama 是否可用(系统安装 或 打包二进制)
//   - 启动 ollama serve(后台子进程,绑定 127.0.0.1:11434)
//   - 列出已安装模型 (GET /api/tags)
//   - 下载模型 (POST /api/pull,流式进度)
//   - 删除模型 (DELETE /api/delete)
//
// 实现已按职责拆分至 ollama/ 目录:
//   - constants.ts         API 地址 / 超时 / keyless provider 集合
//   - types.ts             模型 / pull 进度 / 推荐模型类型
//   - detection.ts         服务检测(二进制定位 / serve 检测 / PATH 检测)
//   - serve.ts             serve 启停管理
//   - models.ts            模型列表 / 删除
//   - pull.ts              模型下载(流式进度 + 取消)
//   - recommended-models.ts 推荐模型数据
//
// 本文件保留 OllamaService 类入口与单例导出,公共方法签名不变。
// 设计参照 eaa-bridge.ts 的原生二进制管理模式。
// =============================================================

import * as detection from './ollama/detection'
import * as modelsApi from './ollama/models'
import * as pullApi from './ollama/pull'
import * as serveApi from './ollama/serve'
import type { OllamaModel, OllamaPullProgress } from './ollama/types'

export { KEYLESS_PROVIDERS, OLLAMA_BASE_URL, OLLAMA_OPENAI_BASE_URL } from './ollama/constants'
export { RECOMMENDED_MODELS } from './ollama/recommended-models'
export type { OllamaModel, OllamaPullProgress, RecommendedModel } from './ollama/types'

class OllamaService {
  private detectionState: detection.DetectionState = { available: null }
  private serveState: serveApi.ServeState = { process: null }
  private pullState: pullApi.PullState = { abortController: null }

  /**
   * 解析 ollama 二进制路径。
   * 优先级: 系统 PATH > 打包 resources/ollama/
   */
  resolveBinaryPath(): string | null {
    return detection.resolveBinaryPath()
  }

  /**
   * 检测 ollama 是否可用(二进制存在 OR serve 已在运行)。
   * 结果缓存(直到 reset)。
   */
  async detect(): Promise<boolean> {
    return detection.detect(this.detectionState)
  }

  /** 重置检测结果缓存(强制重新检测) */
  resetDetection(): void {
    detection.resetDetection(this.detectionState)
  }

  /** 检查 ollama serve 是否已在 11434 端口运行 */
  async isServeRunning(): Promise<boolean> {
    return detection.isServeRunning()
  }

  /**
   * 启动 ollama serve(后台子进程)。
   * 如果 serve 已在运行,直接返回。
   * @returns 是否成功启动
   */
  async startServe(): Promise<boolean> {
    return serveApi.startServe(this.serveState)
  }

  /** 停止 ollama serve(仅停止我们启动的子进程) */
  stopServe(): void {
    serveApi.stopServe(this.serveState)
  }

  /**
   * 列出已安装模型。
   * 需要 serve 在运行。
   */
  async listModels(): Promise<OllamaModel[]> {
    return modelsApi.listModels()
  }

  /**
   * 下载(pull)一个模型,流式返回进度。
   * M-1 修复: 使用 AbortController 支持取消下载(通过 cancelPull())。
   * @param modelName 模型名,如 "qwen3:1.7b"
   * @param onProgress 进度回调
   */
  async pullModel(
    modelName: string,
    onProgress: (p: OllamaPullProgress) => void,
  ): Promise<{ success: boolean; error?: string }> {
    return pullApi.pullModel(this.pullState, modelName, onProgress)
  }

  /** 删除一个已安装模型 */
  async deleteModel(modelName: string): Promise<{ success: boolean; error?: string }> {
    return modelsApi.deleteModel(modelName)
  }
}

/** Ollama 服务单例 */
export const ollamaService = new OllamaService()
