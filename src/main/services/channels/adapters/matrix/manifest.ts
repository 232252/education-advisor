import type { ChannelManifest } from '@shared/types'

export const MATRIX_MANIFEST_ID = 'matrix'

export const matrixManifest: ChannelManifest = {
  id: MATRIX_MANIFEST_ID,
  label: 'Matrix',
  description: 'Matrix homeserver + access_token;/sync 长轮询收信。',
  icon: 'matrix',
  category: 'overseas',
  region: 'foreign',
  priority: 73,
  qwenpawKey: 'matrix',
  catalogStatus: 'enabled',
  beta: true,
  docsUrl: 'https://spec.matrix.org/latest/client-server-api/',
  limitationBannerKey: 'channels.matrix.limitation',
  capabilities: {
    receivesVia: 'polling',
    streamingKind: 'none',
    canSendCard: false,
    maxTextLength: null,
    replyWindowMs: null,
    streamWindowMs: null,
    pushPolicy: 'free',
    receivesFiles: false,
  },
  configSchema: [
    { name: 'homeserver', label: 'Homeserver URL', type: 'string', required: true },
    { name: 'userId', label: 'User ID', type: 'string', required: true },
    { name: 'accessToken', label: 'Access Token', type: 'secret', required: true },
    { name: 'proxyUrl', label: '代理提示(可选)', type: 'string' },
  ],
  setupGuide: {
    title: 'Matrix 连接清单',
    steps: [
      '准备 homeserver(如 https://matrix.org)与用户 @user:server',
      '登录获取 access_token(Element 设置或登录 API)',
      'Bot 用户须已加入目标房间',
    ],
  },
}
