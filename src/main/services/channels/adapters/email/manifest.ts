import type { ChannelManifest } from '@shared/types'

export const EMAIL_MANIFEST_ID = 'email'

export const emailManifest: ChannelManifest = {
  id: EMAIL_MANIFEST_ID,
  label: '邮件',
  description: 'IMAP 收信 + SMTP 发信。适合家长通知与作业往来;需填写邮箱与授权码。',
  icon: 'email',
  category: 'email',
  region: 'domestic',
  priority: 35,
  qwenpawKey: 'email',
  catalogStatus: 'enabled',
  limitationBannerKey: 'channels.email.limitation',
  beta: true,
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
  ],
  setupGuide: {
    title: '邮件连接清单',
    steps: [
      '在邮箱服务商开启 IMAP/SMTP,并生成应用授权码',
      '填写主机、端口与账号授权码后测试连接',
      '建议使用专用通知邮箱,勿用个人主邮箱密码',
    ],
  },
}
