// =============================================================
// Ollama 常量 — REST API 地址 / provider 集合 / 超时配置
// =============================================================

/** Ollama REST API 基地址(固定本地) */
export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
/** Ollama OpenAI 兼容端点(pi-ai provider baseUrl) */
export const OLLAMA_OPENAI_BASE_URL = 'http://127.0.0.1:11434/v1'
/** 本地/keyless provider 列表 — 这些 provider 不需要 apiKey */
export const KEYLESS_PROVIDERS = new Set(['ollama'])
/** Ollama 连接检测超时(ms) */
export const HEALTH_TIMEOUT_MS = 3000
/** Ollama serve 启动等待(ms) */
export const SERVE_WAIT_MS = 2000
