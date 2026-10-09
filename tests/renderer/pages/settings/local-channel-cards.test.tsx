import { cleanup, render, screen } from '@testing-library/react'
import type { ChannelInstanceInfo } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

const rows: ChannelInstanceInfo[] = [
  {
    manifest: {
      id: 'feishu',
      label: '飞书',
      description: '聊天',
      icon: 'feishu',
      capabilities: {
        receivesVia: 'ws',
        streamingKind: 'none',
        canSendCard: false,
        maxTextLength: null,
        replyWindowMs: null,
        streamWindowMs: null,
        pushPolicy: 'free',
        receivesFiles: false,
      },
      configSchema: [],
    },
    configured: false,
    enabled: true,
    status: { channel: 'feishu', status: 'not-configured', processingCount: 0, pendingCount: 0 },
  },
  {
    manifest: {
      id: 'mqtt',
      label: 'MQTT',
      description: '物联网消息桥',
      icon: 'mqtt',
      catalogStatus: 'enabled',
      capabilities: {
        receivesVia: 'mqtt',
        streamingKind: 'none',
        canSendCard: false,
        maxTextLength: null,
        replyWindowMs: null,
        streamWindowMs: null,
        pushPolicy: 'free',
        receivesFiles: false,
      },
      configSchema: [{ name: 'host', label: 'Broker 主机', type: 'string', required: true }],
    },
    configured: false,
    enabled: false,
    status: { channel: 'mqtt', status: 'disabled', processingCount: 0, pendingCount: 0 },
  },
]

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    channels: {
      list: async () => rows,
      test: async () => ({ ok: true, message: 'ok' }),
      onStatusUpdate: () => () => {},
    },
  }),
}))

import { LocalChannelCards } from '../../../../src/renderer/pages/Settings/channels/LocalChannelCards'

describe('本机渠道卡片', () => {
  afterEach(() => cleanup())

  it('只显示插件没有的渠道', async () => {
    render(
      <LocalChannelCards
        settings={{ channels: { mqtt: { host: '' } } } as never}
        onSave={vi.fn()}
      />,
    )
    expect(await screen.findByText('MQTT')).toBeTruthy()
    expect(screen.queryByText('飞书')).toBeNull()
  })
})
