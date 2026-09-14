import type { ChannelManifest } from '@shared/types'

export const EMAIL_MANIFEST_ID = 'email'

export const emailManifest: ChannelManifest = {
  id: EMAIL_MANIFEST_ID,
  label: '邮件',
  description: 'IMAP 收信(IDLE/轮询) + SMTP 发信。适合家长通知与业务邮件;请用应用授权码。',
  icon: 'email',
  category: 'email',
  region: 'domestic',
  priority: 35,
  qwenpawKey: 'email',
  catalogStatus: 'enabled',
  limitationBannerKey: 'channels.email.limitation',
  beta: true,
  docsUrl: 'https://nodemailer.com/',
  capabilities: {
    receivesVia: 'imap-idle',
    streamingKind: 'none',
    canSendCard: false,
    maxTextLength: null,
    replyWindowMs: null,
    streamWindowMs: null,
    pushPolicy: 'free',
    receivesFiles: true,
  },
  configSchema: [
    { name: 'imapHost', label: 'IMAP 主机', type: 'string', required: true },
    { name: 'imapPort', label: 'IMAP 端口', type: 'number', default: 993, required: true },
    { name: 'smtpHost', label: 'SMTP 主机', type: 'string', required: true },
    { name: 'smtpPort', label: 'SMTP 端口', type: 'number', default: 465, required: true },
    { name: 'username', label: '邮箱账号', type: 'string', required: true },
    { name: 'password', label: '授权码/密码', type: 'secret', required: true },
    { name: 'mailbox', label: '收件箱名', type: 'string', default: 'INBOX' },
    {
      name: 'preferIdle',
      label: '优先 IMAP IDLE',
      type: 'boolean',
      default: true,
      description: '关闭则固定轮询(部分托管邮箱 IDLE 不稳)',
    },
    {
      name: 'pollIntervalSec',
      label: '轮询间隔(秒)',
      type: 'number',
      default: 60,
      description: 'IDLE 失败降级或 preferIdle=false 时使用',
    },
  ],
  setupGuide: {
    title: '邮件连接清单',
    steps: [
      '邮箱后台开启 IMAP/SMTP,并生成应用授权码',
      '填写主机/端口/账号/授权码后连接:SMTP 发信 + IMAP 收信',
      '建议使用专用通知邮箱,勿用个人主邮箱授权码',
      '若 IDLE 不可用会自动降级轮询;可在配置关闭 preferIdle',
    ],
  },
}
