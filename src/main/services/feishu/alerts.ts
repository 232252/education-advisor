// =============================================================
// feishu/alerts — Agent 产物的出站推送(主动发送通道)
// 此前 sendTextMessage 已实现但全仓库无调用方(出站通道闲置),
// 本模块把它接到两类场景:
//   1. escalate_to_main 工具: 安全类 agent 发现紧急情况时立即推送给教师
//   2. cron 任务产出: 周报/预警等定时结果推送给教师(需开启 feishu.agentPushEnabled)
// 未配置飞书 / 未开启开关时返回 skipped,调用方据此降级。
// =============================================================

import { errText } from '../../utils/err-text'
import { keystoreService } from '../keystore-service'
import { settingsService } from '../settings-service'
import { sendTextMessage } from './messages'

/** 飞书文本消息单条安全上限(超长截断,留余量) */
const FEISHU_TEXT_MAX_CHARS = 3500

/**
 * 定时任务完成后需要推送结果的 agent 名单(需同时开启
 * settings.feishu.agentPushEnabled 才生效)。
 * 只推送"产出报告类"角色,日常操作性角色(class-monitor 等)不推送避免打扰。
 */
export const FEISHU_PUSH_AGENT_IDS = [
  'weekly-reporter',
  'risk-alert',
  'governor',
  'psychology',
  'counselor',
  'academic',
]

export interface FeishuAlertResult {
  success: boolean
  skipped?: string
  error?: string
}

function truncate(text: string): string {
  return text.length > FEISHU_TEXT_MAX_CHARS
    ? `${text.slice(0, FEISHU_TEXT_MAX_CHARS)}\n...(已截断)`
    : text
}

/** 飞书推送是否具备基本配置(appId + appSecret + userOpenId) */
export function isFeishuPushConfigured(): boolean {
  const s = settingsService.getSettings()
  return Boolean(s.feishu?.appId && s.feishu?.userOpenId)
}

/**
 * 把一段文本推送给教师(openId 对应用户)。
 * - 未配置 appId/userOpenId → skipped(调用方降级,不算错误)
 * - 发送失败 → { success: false, error },调用方记录日志
 */
export async function sendAgentAlert(title: string, body: string): Promise<FeishuAlertResult> {
  try {
    const s = settingsService.getSettings()
    const appId = s.feishu?.appId ?? ''
    const userOpenId = s.feishu?.userOpenId ?? ''
    if (!appId || !userOpenId) {
      return { success: false, skipped: 'feishu appId/userOpenId 未配置' }
    }
    const appSecret = keystoreService.getSecret('feishu-app-secret') ?? ''
    if (!appSecret) {
      return { success: false, skipped: 'feishu appSecret 未配置(keystore)' }
    }
    const domain = s.feishu?.domain ?? 'feishu'
    const text = `【${title}】\n${truncate(body)}`
    return await sendTextMessage(appId, appSecret, userOpenId, text, domain)
  } catch (err) {
    return { success: false, error: errText(err) }
  }
}
