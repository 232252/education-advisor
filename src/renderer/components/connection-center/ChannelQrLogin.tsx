// =============================================================
// ChannelQrLogin — 渠道扫码登录(begin/poll/cancel IPC)
// 状态机: pending → scanned → confirmed | expired | error
// =============================================================

import { Loader2, QrCode as QrIcon, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { cn } from '../../lib/ui-utils'
import { toast } from '../../stores/toastStore'
import { QrCode } from './QrCode'

interface ChannelQrLoginProps {
  channelId: string
  /** 绑定成功后回调(刷新 list / 关面板) */
  onConfirmed?: () => void
  className?: string
}

type Phase = 'idle' | 'loading' | 'pending' | 'scanned' | 'confirmed' | 'expired' | 'error'

export function ChannelQrLogin({ channelId, onConfirmed, className }: ChannelQrLoginProps) {
  const { t } = useT()
  const [phase, setPhase] = useState<Phase>('idle')
  const [qrContent, setQrContent] = useState('')
  const [detail, setDetail] = useState('')
  const loginIdRef = useRef<string | null>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const mounted = useRef(true)

  const stopPoll = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  const cancel = useCallback(async () => {
    stopPoll()
    const id = loginIdRef.current
    loginIdRef.current = null
    if (id) {
      try {
        await getAPI().channels.cancelLogin(id)
      } catch {
        /* ignore */
      }
    }
    if (mounted.current) {
      setPhase('idle')
      setQrContent('')
      setDetail('')
    }
  }, [stopPoll])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stopPoll()
      const id = loginIdRef.current
      if (id)
        void getAPI()
          .channels.cancelLogin(id)
          .catch(() => {})
    }
  }, [stopPoll])

  const startPoll = useCallback(
    (loginId: string) => {
      stopPoll()
      pollTimer.current = setInterval(() => {
        void (async () => {
          try {
            const r = await getAPI().channels.pollLogin(loginId)
            if (!mounted.current) return
            if (r.status === 'pending') {
              setPhase('pending')
              setDetail(r.detail || '')
            } else if (r.status === 'scanned') {
              setPhase('scanned')
              setDetail(r.detail || t('channels.qr.scanned', '已扫码,请在手机上确认'))
            } else if (r.status === 'confirmed') {
              stopPoll()
              setPhase('confirmed')
              setDetail(r.detail || t('channels.qr.confirmed', '绑定成功'))
              toast.success(r.detail || t('channels.qr.confirmed', '绑定成功'))
              onConfirmed?.()
            } else if (r.status === 'expired') {
              stopPoll()
              setPhase('expired')
              setDetail(r.detail || t('channels.qr.expired', '二维码已过期'))
            } else if (r.status === 'error' || r.status === 'cancelled') {
              stopPoll()
              setPhase(r.status === 'cancelled' ? 'idle' : 'error')
              setDetail(r.detail || '')
            }
          } catch (err) {
            if (!mounted.current) return
            stopPoll()
            setPhase('error')
            setDetail(String(err))
          }
        })()
      }, 2000)
    },
    [onConfirmed, stopPoll, t],
  )

  const begin = async () => {
    setPhase('loading')
    setDetail('')
    try {
      const r = await getAPI().channels.beginLogin(channelId)
      if (!mounted.current) return
      loginIdRef.current = r.loginId
      setQrContent(r.qrContent)
      setPhase('pending')
      startPoll(r.loginId)
    } catch (err) {
      setPhase('error')
      setDetail(String(err))
      toast.error(String(err))
    }
  }

  return (
    <div
      data-testid="channel-qr-login"
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-gray-200 dark:border-white/[0.08] p-3',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-200">
        <QrIcon size={14} />
        {t('channels.qr.title', '扫码连接')}
      </div>

      {phase === 'idle' && (
        <button
          type="button"
          onClick={() => void begin()}
          className="inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20"
        >
          {t('channels.qr.start', '开始扫码')}
        </button>
      )}

      {phase === 'loading' && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 size={14} className="animate-spin" />
          {t('channels.qr.loading', '正在获取二维码…')}
        </div>
      )}

      {(phase === 'pending' || phase === 'scanned') && qrContent && (
        <div className="flex flex-col items-center gap-2">
          <QrCode value={qrContent} size={160} />
          <p className="text-[11px] text-center text-gray-500 dark:text-gray-400">
            {phase === 'scanned'
              ? detail || t('channels.qr.scanned', '已扫码,请在手机上确认')
              : t('channels.qr.scanHint', '请用对应 App 扫描二维码')}
          </p>
          <button
            type="button"
            onClick={() => void cancel()}
            className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700"
          >
            <X size={12} />
            {t('channels.qr.cancel', '取消')}
          </button>
        </div>
      )}

      {phase === 'confirmed' && (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
          ✅ {detail || t('channels.qr.confirmed', '绑定成功')}
        </p>
      )}

      {(phase === 'expired' || phase === 'error') && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-red-500 dark:text-red-400">
            {detail ||
              (phase === 'expired'
                ? t('channels.qr.expired', '二维码已过期')
                : t('channels.qr.error', '扫码失败'))}
          </p>
          <button
            type="button"
            onClick={() => void begin()}
            className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/[0.08]"
          >
            <RefreshCw size={12} />
            {t('channels.qr.retry', '重新扫码')}
          </button>
        </div>
      )}
    </div>
  )
}
