// =============================================================
// adapters/mqtt — MQTT 薄客户端骨架(mqtt.js;配置齐则可连)
// =============================================================

import type {
  ChannelConfigValidation,
  ChannelRunStatus,
  InboundMessage,
  OutboundContent,
  PushTarget,
} from '@shared/types'
import { log } from '../../../../utils/logger'
import type { ChannelAdapter, ChannelRuntimeContext } from '../../types'
import { MQTT_MANIFEST_ID, mqttManifest } from './manifest'

type MqttClientLike = {
  on(event: string, cb: (...args: unknown[]) => void): void
  subscribe(topic: string): void
  publish(topic: string, payload: string): void
  end(force: boolean, opts: Record<string, unknown>, cb?: () => void): void
}

export class MqttChannelAdapter implements ChannelAdapter {
  readonly id = MQTT_MANIFEST_ID
  readonly manifest = mqttManifest
  private client: MqttClientLike | null = null
  private status: ChannelRunStatus = 'disabled'
  private detail?: string
  private connectedAt?: number
  private lastMessageAt?: number
  private publishTopic = ''

  async validateConfig(
    ctx: Pick<ChannelRuntimeContext, 'config' | 'getSecret'>,
  ): Promise<ChannelConfigValidation> {
    const host = String(ctx.config.host ?? '').trim()
    if (!host) return { ok: false, message: 'Broker 主机未填写', field: 'host' }
    const sub = String(ctx.config.subscribeTopic ?? '').trim()
    if (!sub) return { ok: false, message: '订阅 Topic 未填写', field: 'subscribeTopic' }
    const pub = String(ctx.config.publishTopic ?? '').trim()
    if (!pub) return { ok: false, message: '发布 Topic 未填写', field: 'publishTopic' }
    return { ok: true }
  }

  async connect(ctx: ChannelRuntimeContext): Promise<void> {
    const host = String(ctx.config.host ?? '').trim()
    const port = Number(ctx.config.port ?? 1883)
    const username = String(ctx.config.username ?? '').trim() || undefined
    const password = ((await ctx.getSecret('password')) ?? '').trim() || undefined
    const tls = ctx.config.tls === true
    const subscribeTopic = String(ctx.config.subscribeTopic ?? '').trim()
    this.publishTopic = String(ctx.config.publishTopic ?? '').trim()
    const protocol = tls ? 'mqtts' : 'mqtt'
    const url = `${protocol}://${host}:${port}`

    ctx.bridge.onStatus({ status: 'connecting' })
    this.status = 'connecting'

    let mqttMod: { connect: (url: string, opts?: Record<string, unknown>) => MqttClientLike }
    try {
      mqttMod = (await import('mqtt')) as unknown as {
        connect: (url: string, opts?: Record<string, unknown>) => MqttClientLike
      }
    } catch {
      this.status = 'error'
      this.detail = '未安装 mqtt 依赖:请执行 npm i mqtt'
      ctx.bridge.onStatus({ status: 'error', detail: this.detail, lastErrorAt: Date.now() })
      throw new Error(this.detail)
    }

    await new Promise<void>((resolve, reject) => {
      const client = mqttMod.connect(url, {
        username,
        password,
        reconnectPeriod: 0,
        connectTimeout: 10_000,
      })
      this.client = client
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('MQTT 连接超时'))
      }, 12_000)
      const cleanup = () => clearTimeout(timer)
      client.on('connect', () => {
        cleanup()
        try {
          client.subscribe(subscribeTopic)
        } catch (err) {
          reject(err)
          return
        }
        this.status = 'connected'
        this.connectedAt = Date.now()
        this.detail = undefined
        ctx.bridge.onStatus({ status: 'connected', connectedAt: this.connectedAt })
        resolve()
      })
      client.on('error', (err: unknown) => {
        cleanup()
        const msg = err instanceof Error ? err.message : String(err)
        this.status = 'error'
        this.detail = msg
        ctx.bridge.onStatus({ status: 'error', detail: msg, lastErrorAt: Date.now() })
        reject(new Error(msg))
      })
      client.on('message', (topic: unknown, payload: unknown) => {
        this.lastMessageAt = Date.now()
        const text =
          typeof payload === 'string'
            ? payload
            : Buffer.isBuffer(payload)
              ? payload.toString('utf8')
              : String(payload ?? '')
        const msg: InboundMessage = {
          channel: this.id,
          providerMessageId: `mqtt:${String(topic)}:${Date.now()}`,
          chat: { id: String(topic), type: 'p2p' },
          sender: { id: String(topic) },
          text,
          attachments: [],
          receivedAt: Date.now(),
        }
        ctx.bridge.onMessage(msg)
        ctx.bridge.onStatus({
          status: 'connected',
          connectedAt: this.connectedAt,
          lastMessageAt: this.lastMessageAt,
        })
      })
    })
    log('info', 'mqtt', `connected ${url} sub=${subscribeTopic}`)
  }

  async disconnect(): Promise<void> {
    const client = this.client
    this.client = null
    if (client) {
      await new Promise<void>((resolve) => {
        try {
          client.end(true, {}, () => resolve())
        } catch {
          resolve()
        }
      })
    }
    this.status = 'disabled'
  }

  getStatus() {
    return {
      status: this.status,
      detail: this.detail,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
    }
  }

  async sendReply(_msg: InboundMessage, content: OutboundContent): Promise<{ messageId?: string }> {
    if (!this.client || !this.publishTopic) throw new Error('MQTT 未连接')
    this.client.publish(this.publishTopic, content.text)
    return {}
  }

  async push(target: PushTarget, content: OutboundContent): Promise<{ messageId?: string }> {
    if (!this.client) throw new Error('MQTT 未连接')
    const topic = target.chatId || this.publishTopic
    if (!topic) throw new Error('缺少发布 Topic')
    this.client.publish(topic, content.text)
    return {}
  }
}

export function createMqttAdapter(): ChannelAdapter {
  return new MqttChannelAdapter()
}

export { mqttManifest, MQTT_MANIFEST_ID }
