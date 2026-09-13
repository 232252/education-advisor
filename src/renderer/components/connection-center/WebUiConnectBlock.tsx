// =============================================================
// WebUiConnectBlock — 连接中心面板「手机 / 浏览器接入」块(设计文档 §4 + §10.2-10.4)
// 状态机: off → enabling(轮询中) → listening(QR);scheduled 且不在时段
// → 只读提示;error → 提示 + 引导设置页。轮询 3s,仅面板挂载期间运行。
// 动作语义: 开启 = settings:set(general.webUiMode,'always')(持久化,
// 文案明示安全面);关闭 = 'off';不新增任何 IPC。
// 视觉: off 与 listening 两态同构(左侧 144px 取景框占位/真 QR 原位替换,
// 无布局跳变);四角 emerald 取景框是扫码语义的视觉锚点。
// =============================================================

import type { WebUiStatus } from '@shared/types'
import {
  CalendarClock,
  Copy,
  ExternalLink,
  Globe,
  PowerOff,
  QrCode as QrCodeIcon,
  ShieldAlert,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { cn } from '../../lib/ui-utils'
import { toast } from '../../stores/toastStore'
import { QrCode } from './QrCode'

interface WebUiConnectBlockProps {
  /** 跳设置锚点(定时时段管理在设置页) */
  onOpenSettings: (hash: string) => void
}

const POLL_MS = 3000

/** QR 取景框:四角 emerald L 形角标(§10.2),off/listening 两态共用同尺寸壳 */
function QrFrame({ children, testId }: { children: React.ReactNode; testId: string }) {
  const corner = 'absolute w-4 h-4 border-emerald-500/80 pointer-events-none'
  return (
    <div data-testid={testId} className="relative w-[144px] h-[144px] flex-shrink-0">
      {children}
      <span
        aria-hidden
        className={`${corner} -top-1 -left-1 border-t-2 border-l-2 rounded-tl-sm`}
      />
      <span
        aria-hidden
        className={`${corner} -top-1 -right-1 border-t-2 border-r-2 rounded-tr-sm`}
      />
      <span
        aria-hidden
        className={`${corner} -bottom-1 -left-1 border-b-2 border-l-2 rounded-bl-sm`}
      />
      <span
        aria-hidden
        className={`${corner} -bottom-1 -right-1 border-b-2 border-r-2 rounded-br-sm`}
      />
    </div>
  )
}

export function WebUiConnectBlock({ onOpenSettings }: WebUiConnectBlockProps) {
  const { t } = useT()
  const [status, setStatus] = useState<WebUiStatus | null>(null)
  const [enabling, setEnabling] = useState(false)
  // enabling 态最多等 3 个轮询周期,超时回落提示(仍继续轮询,成功自然出现)
  const enableDeadline = useRef(0)

  const refresh = useCallback(async () => {
    try {
      setStatus(await getAPI().sys.getWebUiStatus())
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  // enabling → listening 转换时清标记
  useEffect(() => {
    if (enabling && status?.listening) setEnabling(false)
  }, [enabling, status?.listening])

  const setMode = async (mode: 'always' | 'off') => {
    try {
      const r = await getAPI().settings.set('general.webUiMode', mode)
      if (!r?.success) {
        toast.error(r?.error || t('settings.save.failed', '保存失败'))
        return
      }
      if (mode === 'always') {
        setEnabling(true)
        enableDeadline.current = Date.now() + POLL_MS * 3
        void refresh()
      }
    } catch (err) {
      toast.error(String(err))
    }
  }

  const copyUrl = (url: string) => {
    void navigator.clipboard.writeText(url)
    toast.success(t('page.settings.webui.copied', '已复制访问地址'))
  }

  const openInBrowser = async () => {
    const r = await getAPI().sys.openWebUi()
    if (!r.success) toast.error(r.error || 'open failed')
  }

  /** 手机扫码优先用局域网 IPv4 地址(含令牌),兜底 urls[0] */
  const qrUrl = useMemo(() => {
    if (!status?.listening || status.urls.length === 0) return null
    const lan = status.lanIpv4[0]
    return (lan && status.urls.find((u) => u.includes(lan))) || status.urls[0]
  }, [status])

  const mode = status?.mode ?? 'off'

  // ── 定时模式且不在时段:只读提示,不提供快捷开启(不覆盖用户定时策略) ──
  if (mode === 'scheduled' && status && !status.inSchedule && !status.listening) {
    return (
      <div className="px-3 py-3 flex items-center gap-2.5">
        <CalendarClock size={16} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-700 dark:text-gray-200 font-medium">
            {t('connectionCenter.webui.scheduledOut', '当前不在定时开启时段')}
          </p>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
            {t('connectionCenter.webui.desc', '用手机浏览器控制这台电脑')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenSettings('#webui')}
          className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0"
        >
          {t('connectionCenter.webui.scheduleSettings', '定时设置')} →
        </button>
      </div>
    )
  }

  // ── 监听中:取景框真 QR + 地址 + 动作(§10.2) ──
  if (status?.listening && qrUrl) {
    return (
      <div className="p-3 animate-fade-in">
        <div className="flex items-center gap-3">
          <QrFrame testId="qr-frame">
            <div className="w-full h-full p-2 bg-white rounded-xl border border-gray-200/70 shadow-sm flex items-center justify-center">
              <QrCode value={qrUrl} size={128} className="rounded-lg" />
            </div>
          </QrFrame>
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <Globe size={12} className="text-emerald-500 flex-shrink-0" />
              <span className="text-xs font-medium text-gray-800 dark:text-gray-100">
                {t('connectionCenter.webui.listening', '监听中')}
              </span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                {status.protocol.toUpperCase()} :{status.port}
              </span>
            </div>
            <code
              className="text-[10px] font-mono break-all text-gray-500 dark:text-gray-400 leading-relaxed"
              title={`${qrUrl}\n${t('connectionCenter.webui.tokenHint', '链接包含访问令牌，请勿外传')}`}
            >
              {qrUrl}
            </code>
            <p className="text-[10px] text-gray-400 dark:text-gray-500">
              {status.bind === 'loopback'
                ? t(
                    'connectionCenter.webui.loopbackOnly',
                    '当前仅本机可访问，手机接入请在设置中改为局域网',
                  )
                : t('connectionCenter.webui.scanHint', '局域网内扫码即用')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2.5">
          <button
            type="button"
            onClick={() => copyUrl(qrUrl)}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            <Copy size={11} />
            {t('connectionCenter.webui.copy', '复制地址')}
          </button>
          <button
            type="button"
            onClick={() => void openInBrowser()}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            <ExternalLink size={11} />
            {t('connectionCenter.webui.open', '浏览器打开')}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => void setMode('off')}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
          >
            <PowerOff size={11} />
            {t('connectionCenter.webui.close', '关闭 WebUI')}
          </button>
        </div>
      </div>
    )
  }

  // ── 错误态 ──
  if (status?.error) {
    return (
      <div className="px-3 py-3 flex items-start gap-2.5">
        <ShieldAlert size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-red-600 dark:text-red-400 font-medium">
            {t('settings.channels.status.error', '错误')}
          </p>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 break-all">
            {status.error}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenSettings('#webui')}
          className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0"
        >
          {t('connectionCenter.openSettings', '完整设置')} →
        </button>
      </div>
    )
  }

  // ── 关闭态(含 enabling 轮询等待;§10.3 与 listening 同构,占位框原位替换真 QR) ──
  const enableTimedOut = enabling && Date.now() > enableDeadline.current
  return (
    <div className="p-3">
      <div className="flex items-center gap-3">
        <QrFrame testId="qr-placeholder">
          <div className="w-full h-full rounded-xl border-2 border-dashed border-gray-300 dark:border-white/[0.15] bg-gray-100/50 dark:bg-white/[0.03] flex items-center justify-center animate-fade-in">
            <QrCodeIcon size={28} className="text-gray-300 dark:text-gray-600" />
          </div>
        </QrFrame>
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Globe size={12} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
            <span className="text-xs font-medium text-gray-800 dark:text-gray-100">
              {t('connectionCenter.webui.off', '未开启')}
            </span>
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500">
            {t('connectionCenter.webui.desc', '用手机浏览器控制这台电脑')}
          </p>
          <p className="flex items-start gap-1 text-[10px] text-amber-600/90 dark:text-amber-400/90 leading-relaxed">
            <ShieldAlert size={11} className="flex-shrink-0 mt-px" />
            {t('connectionCenter.webui.securityHint', '开启后，局域网内持有链接的人可访问本应用')}
          </p>
          {enableTimedOut && (
            <p className="text-[10px] text-red-500">
              {t('connectionCenter.webui.enableSlow', '开启较慢，请稍候或到设置页查看')}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2.5">
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void setMode('always')}
          disabled={enabling}
          className={cn(
            'inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg flex-shrink-0',
            'border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
            'hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
          )}
        >
          {enabling
            ? t('connectionCenter.webui.enabling', '开启中…')
            : t('connectionCenter.webui.enable', '开启并生成二维码')}
        </button>
      </div>
    </div>
  )
}
