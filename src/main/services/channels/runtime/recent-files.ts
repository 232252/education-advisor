// =============================================================
// channels/runtime/recent-files — 每会话"最近发来的文件"记忆
// (M2 从 feishu-bot/recent-files.ts 上提,行为不变;原文件改为 re-export 壳)
// 用户常先发文件、随后只说"这个你看得到吗/把刚才的表录入"。
// 把最近文件路径注入 Agent prompt,Agent 即可按路径读取。
// 平台无关(按 chatId 记忆,与渠道无关)。
// =============================================================

export interface RecentFile {
  name: string
  path: string
  /** 记录时间(ms 时间戳) */
  at: number
}

/** 记忆参数(默认值 = 阶段 0 飞书校准值) */
export interface RecentFilesOptions {
  /** 每会话保留的最近文件数 */
  perChat?: number
  /** 文件引用有效期(ms) */
  ttlMs?: number
}

const DEFAULT_PER_CHAT = 5
const DEFAULT_TTL_MS = 30 * 60 * 1000

export class RecentFilesStore {
  private byChat = new Map<string, RecentFile[]>()
  private readonly perChat: number
  private readonly ttlMs: number

  constructor(options: RecentFilesOptions = {}) {
    this.perChat = options.perChat ?? DEFAULT_PER_CHAT
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  }

  /** 记录一个文件(去重按 path,最新在前,截断到上限) */
  note(chatId: string, file: { name: string; path: string }, at = Date.now()): void {
    const list = this.byChat.get(chatId) ?? []
    const filtered = list.filter((f) => f.path !== file.path)
    filtered.unshift({ name: file.name, path: file.path, at })
    this.byChat.set(chatId, filtered.slice(0, this.perChat))
  }

  /** 该会话在有效期内的最近文件(最新在前) */
  fresh(chatId: string, now = Date.now()): RecentFile[] {
    const list = this.byChat.get(chatId) ?? []
    return list.filter((f) => now - f.at <= this.ttlMs)
  }
}
