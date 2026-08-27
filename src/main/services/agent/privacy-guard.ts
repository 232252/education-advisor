// =============================================================
// Privacy Guard — LLM 链路自动脱敏(修复"文档承诺但从未接线"的断链)
//
// 此前状态: docs/PRIVACY_ENGINE.md 宣称"每次 LLM 调用前自动 anonymize",
// 实际 anonymize/deanonymize 无任何调用方;settings.privacy.autoAnonymize
// 只有类型声明,无代码消费。本模块把 Rust 隐私引擎真正接进 Agent 执行链路:
//
//   出域(→LLM):  用户 prompt / 对话历史 / 工具结果文本  真名→化名(S_001)
//   回域(→用户): 流式输出增量 / 最终输出 / 工具入参     化名→真名
//
// 映射来源: `eaa privacy list`(一次 CLI 调用),后续替换在 TS 内存完成
// (与 Rust AhoCorasick 精确替换语义一致,长名优先避免子串误替换),
// 避免每个 delta/工具调用都 spawn 一次 CLI。
//
// 失败策略(fail-closed): settings 同时打开 privacy.enabled+autoAnonymize
// 但隐私引擎未解锁(无密码)时,executeAgentRun 直接报错终止 —
// 用户已明确表达脱敏意图,静默发送明文违背该意图。
// =============================================================

import { eaaBridge } from '../eaa-bridge'
import { settingsService } from '../settings-service'

/** 化名格式: 前缀_三位数字(如 S_001 / P_012 / SCH_003),与 Rust format!("{}_{:03}") 一致 */
const ALIAS_RE = /^[A-Za-z]+_\d{3}$/
/** privacy list 表格行的列分隔(两列间由 Rust {:<6}/{:<12} 填充产生 ≥2 空格) */
const LIST_ROW_RE = /^(\S+(?:\s\S+)*)\s{2,}([A-Za-z]+_\d{3})\s{2,}(.+)$/

/** 自动脱敏是否在设置中开启(还需隐私引擎已解锁才真正生效) */
export function isAutoAnonymizeEnabled(): boolean {
  const p = settingsService.getSettings().privacy
  return Boolean(p?.enabled && p?.autoAnonymize)
}

/** 开启自动脱敏但引擎未解锁时抛错(fail-closed,调用方转为执行失败) */
export function assertPrivacyReadyForRun(): void {
  if (isAutoAnonymizeEnabled() && !eaaBridge.hasPrivacyPassword()) {
    throw new Error(
      '已开启隐私自动脱敏(privacy.autoAnonymize),但隐私引擎尚未解锁 — 请先在隐私设置中输入密码解锁,否则包含学生真实姓名的内容不会发送给模型。',
    )
  }
}

/**
 * 一次 Agent 运行的脱敏守卫实例。
 * 构造时加载一次映射;映射加载失败且已开启脱敏时抛错(fail-closed)。
 */
export class PrivacyGuard {
  /** 真名 → 化名(长名优先替换,避免"王小明"先命中"小明") */
  private readonly plainToAlias: Array<[string, string]>
  /** 化名 → 真名 */
  private readonly aliasToPlain: Map<string, string>
  private readonly aliases: string[]

  private constructor(mapping: Array<{ alias: string; plain: string }>) {
    this.plainToAlias = mapping
      .map((m) => [m.plain, m.alias] as [string, string])
      .sort((a, b) => b[0].length - a[0].length)
    this.aliasToPlain = new Map(mapping.map((m) => [m.alias, m.plain]))
    this.aliases = mapping.map((m) => m.alias)
  }

  /** 加载映射并创建守卫;无映射条目时也返回实例(替换为 no-op) */
  static async create(): Promise<PrivacyGuard> {
    const result = await eaaBridge.execute({
      command: 'privacy',
      args: ['list'],
    })
    const text = typeof result.data === 'string' ? result.data : String(result.data ?? '')
    if (!result.success || text.startsWith('❌') || text.includes('EAA_PRIVACY_PASSWORD')) {
      throw new Error(`隐私映射加载失败: ${text.slice(0, 200)}`)
    }
    const mapping: Array<{ alias: string; plain: string }> = []
    for (const line of text.split('\n')) {
      const m = LIST_ROW_RE.exec(line.trim())
      if (m && ALIAS_RE.test(m[2])) {
        mapping.push({ alias: m[2], plain: m[3].trim() })
      }
    }
    return new PrivacyGuard(mapping)
  }

  /** 当前映射条数(诊断/测试) */
  get mappingCount(): number {
    return this.aliases.length
  }

  /** 真名 → 化名(出域方向: 发给 LLM 前) */
  anonymize(text: string): string {
    let out = text
    for (const [plain, alias] of this.plainToAlias) {
      if (plain && out.includes(plain)) {
        out = out.split(plain).join(alias)
      }
    }
    return out
  }

  /** 化名 → 真名(回域方向: 返回用户前) */
  deanonymize(text: string): string {
    if (this.aliasToPlain.size === 0) return text
    let out = text
    for (const [alias, plain] of this.aliasToPlain) {
      if (out.includes(alias)) {
        out = out.split(alias).join(plain)
      }
    }
    return out
  }

  /**
   * 流式增量安全还原: 尾部可能是化名前缀的字符先扣住,下一段到达后再判定,
   * 避免把 "S_001" 切成 "S_0"+"01" 导致替换遗漏。flush() 释放残留。
   */
  createStreamDeanonymizer(): { push(delta: string): string; flush(): string } {
    let carry = ''
    const maxAliasLen = this.aliases.reduce((m, a) => Math.max(m, a.length), 0)
    const isProperPrefixOfAlias = (s: string): boolean =>
      this.aliases.some((a) => a.length > s.length && a.startsWith(s))
    return {
      push: (delta: string) => {
        const buf = carry + delta
        let safeEnd = buf.length
        const maxCheck = Math.min(buf.length, maxAliasLen - 1)
        for (let k = maxCheck; k > 0; k--) {
          const tail = buf.slice(buf.length - k)
          if (isProperPrefixOfAlias(tail)) {
            safeEnd = buf.length - k
            break
          }
        }
        const emit = buf.slice(0, safeEnd)
        carry = buf.slice(safeEnd)
        return this.deanonymize(emit)
      },
      flush: () => {
        const rest = carry
        carry = ''
        return this.deanonymize(rest)
      },
    }
  }

  /**
   * 包装 EAA 工具: 入参字符串化名→真名(模型看到的是化名,执行需真名),
   * 结果文本真名→化名(工具输出回流 LLM 上下文前)。
   * 结果兼容两种形态: 纯字符串 / AgentToolResult({content:[{type:'text',text}]})。
   * 非 EAA 工具(文件/实用/MCP)不包装 — 见模块头部的范围说明。
   */
  wrapTool<
    // biome-ignore lint/suspicious/noExplicitAny: TSchema constraint requires any
    T extends { execute: (id: string, params: any, signal?: AbortSignal) => Promise<unknown> },
  >(tool: T): T {
    const original = tool.execute.bind(tool)
    // biome-ignore lint/suspicious/noExplicitAny: TSchema constraint requires any
    tool.execute = async (toolCallId: string, params: any, signal?: AbortSignal) => {
      const deanonParams =
        params && typeof params === 'object' && !Array.isArray(params)
          ? Object.fromEntries(
              Object.entries(params).map(([k, v]) => [
                k,
                typeof v === 'string' ? this.deanonymize(v) : v,
              ]),
            )
          : params
      const result = await original(toolCallId, deanonParams, signal)
      if (typeof result === 'string') {
        return this.anonymize(result)
      }
      if (
        result &&
        typeof result === 'object' &&
        Array.isArray((result as { content?: unknown }).content)
      ) {
        const r = result as { content: Array<{ type?: string; text?: string }> }
        return {
          ...r,
          content: r.content.map((c) =>
            typeof c.text === 'string' ? { ...c, text: this.anonymize(c.text) } : c,
          ),
        }
      }
      return result
    }
    return tool
  }
}
