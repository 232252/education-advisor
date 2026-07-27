// =============================================================
// 全局类型声明
// =============================================================

// ws 库无内置类型声明,此处声明宽松接口供 mcp-service.ts / mcp-client-pool.ts 使用
declare module 'ws' {
  export interface WebSocket {
    readonly readyState: number
    on(event: string, listener: (...args: unknown[]) => void): this
    send(data: string): void
    close(): void
  }

  export default class WebSocketImpl implements WebSocket {
    constructor(url: string, options?: { headers?: Record<string, string> })
    readonly readyState: number
    on(event: string, listener: (...args: unknown[]) => void): this
    send(data: string): void
    close(): void
  }
}
