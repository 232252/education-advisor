// =============================================================
// save_memory 工具 — Agent 持久化记忆的写入入口
// 所有 agent 均获得该工具(记忆是通用能力);读取不需要工具 —
// 记忆段落由 memoryService.getMemorySection 在每次运行时自动注入
// system prompt(见 agent/execution.ts)。
// =============================================================

import type { AgentTool } from '@main/services/llm-contracts'
import { Type } from 'typebox'
import { errText } from '../../utils/err-text'
import { textResult } from '../eaa/tools/shared'
import { memoryService } from './memory-service'
import type { PrivacyGuard } from './privacy-guard'

const saveMemoryParams = Type.Object({
  content: Type.String({
    description:
      '要记住的内容(一句话事实或偏好,如"用户偏好简洁的中文回复""张三的家长习惯晚上8点后联系")。保存前先对照本次已注入的长期记忆段,已有相同或同义内容时不要重复保存',
  }),
  category: Type.Optional(
    Type.String({
      description:
        '记忆类别: user_preference(用户偏好) / fact(事实结论) / task(任务备忘,14 天未重新保存将不再注入;任务仍在进行时重新保存一次即可续期),默认 fact',
    }),
  ),
})

/**
 * 创建 save_memory 工具实例(每次运行重建,捕获当次 agentId)。
 * R2-08: privacyGuard 存在时,落盘前把内容中的化名还原为真名 —
 * 记忆是本地数据,存储基准态与 entities.json 一致(本地真名/出域脱敏);
 * 若存化名,隐私引擎重置后映射丢失,S_xxx 将永远无法还原,记忆库变废。
 * 注入侧(execution.ts)在每次运行时按当次脱敏开关重新 anonymize。
 */
export function createMemoryTool(
  agentId: string,
  privacyGuard?: PrivacyGuard,
): AgentTool<typeof saveMemoryParams> {
  return {
    name: 'save_memory',
    label: '保存长期记忆',
    description:
      '把重要信息保存为长期记忆,下次运行时自动加载。适合保存: 用户偏好(称呼、沟通风格、常用操作)、跨会话需要记住的事实结论(如"李四的数学需重点关注")、未完成的任务备忘。不要保存无关紧要的闲聊内容。',
    parameters: saveMemoryParams,
    execute: async (_toolCallId, params) => {
      const category = params.category?.trim() || 'fact'
      try {
        const raw = params.content.trim()
        const content = privacyGuard ? privacyGuard.deanonymize(raw) : raw
        const entry = await memoryService.addEntry(agentId, content, category)
        // 回执回显完整存储内容: 只回显前 100 字时模型无法察觉截断,
        // 会以为完整保存了(长内容实际被截断到 500 字符)
        const wasTruncated = entry.content.endsWith('…') || entry.content.length < content.length
        const lines = [
          entry.deduped
            ? `已存在相同内容的记忆,已刷新其时间而未重复保存: [${entry.category}] ${entry.content}`
            : `已保存记忆 [${entry.category}] ${entry.content}`,
        ]
        if (wasTruncated) {
          lines.push('注意: 内容超过单条存储上限,已被截断 — 请把长内容压缩成一句话再保存。')
        }
        lines.push('该记忆将在后续运行中自动加载。')
        return textResult(lines.join('\n'))
      } catch (err) {
        const msg = errText(err)
        return textResult(`保存记忆失败: ${msg}`)
      }
    },
  }
}
