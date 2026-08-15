// =============================================================
// FeishuGuidePanel — 飞书首次使用配置指引(权限/事件订阅清单)
// 结构自 sections/FeishuSection.tsx 逐字搬移
// =============================================================

interface FeishuGuidePanelProps {
  domain: string
}

export function FeishuGuidePanel({ domain }: FeishuGuidePanelProps) {
  return (
    <div className="px-5 py-3 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 bg-blue-50/50 dark:bg-blue-900/10 border-t border-gray-200 dark:border-white/[0.06]/60">
      <div className="font-medium text-blue-600 dark:text-blue-400 mb-1">首次使用飞书对话</div>
      <div className="mb-1 text-emerald-600 dark:text-emerald-400">
        采用长连接模式:无需公网 IP、无需内网穿透,本机在任意网络(含家庭/校园网)都能远程收发消息。
      </div>
      填好 App ID 和 App Secret 后,还需在
      <a
        href={domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'}
        target="_blank"
        rel="noreferrer"
        className="text-blue-500 dark:text-blue-400 underline mx-0.5"
      >
        {domain === 'lark' ? 'Lark Open Platform' : '飞书开放平台'}
      </a>
      后台为该应用:
      <ol className="list-decimal ml-4 mt-1 space-y-0.5">
        <li>「应用能力」→ 启用「机器人」能力</li>
        <li>「事件与回调」→ 订阅方式选「使用长连接接收事件」</li>
        <li>添加事件「接收消息 v2.0」(im.message.receive_v1)</li>
        <li>「权限管理」开启:im:message、im:message:send_as_bot</li>
        <li>创建版本并发布(企业自建应用需管理员审核通过)</li>
      </ol>
      配好后点下方「保存」按钮,再点上方「连接」,即可在飞书里直接对话,发 /help 查看命令。
    </div>
  )
}
