// =============================================================
// WebUI 设置 — 开关 / 端口 / 状态 / 局域网安全 / 高级证书
// =============================================================

import type { UnifiedSettings, WebUiStatus } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import { useT } from '../../../i18n'
import { pickFile } from '../../../lib/dialog'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle, cn, INPUT_SM } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'
import {
  NumberSettingRow,
  Section,
  SelectSettingRow,
  SettingRow,
  ToggleSettingRow,
} from '../components'

interface WebUiSectionProps {
  settings: UnifiedSettings
  onSave: (path: string, value: unknown) => void
}

const DAYS: Array<{ id: number; key: string; fallback: string }> = [
  { id: 1, key: 'page.settings.webui.mon', fallback: '一' },
  { id: 2, key: 'page.settings.webui.tue', fallback: '二' },
  { id: 3, key: 'page.settings.webui.wed', fallback: '三' },
  { id: 4, key: 'page.settings.webui.thu', fallback: '四' },
  { id: 5, key: 'page.settings.webui.fri', fallback: '五' },
  { id: 6, key: 'page.settings.webui.sat', fallback: '六' },
  { id: 0, key: 'page.settings.webui.sun', fallback: '日' },
]

const TLS_FILTERS = [
  { name: 'TLS', extensions: ['pem', 'crt', 'cer', 'key', 'der', 'p8', 'pk8', 'p12', 'pfx'] },
  { name: 'All', extensions: ['*'] },
]

function fileLabel(path: string, empty: string): string {
  const s = path.trim()
  if (!s) return empty
  const parts = s.split(/[/\\]/)
  return parts[parts.length - 1] || s
}

function maskToken(token: string): string {
  if (token.length <= 8) return '••••'
  return `${token.slice(0, 4)}…${token.slice(-4)}`
}

export function WebUiSection({ settings, onSave }: WebUiSectionProps) {
  const { t } = useT()
  const [status, setStatus] = useState<WebUiStatus | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [showToken, setShowToken] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const next = await getAPI().sys.getWebUiStatus()
      setStatus(next)
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(id)
  }, [refresh])

  const days = Array.isArray(settings.general.webUiScheduleDays)
    ? settings.general.webUiScheduleDays
    : [1, 2, 3, 4, 5]

  const toggleDay = (day: number) => {
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day]
    onSave(
      'general.webUiScheduleDays',
      next.sort((a, b) => a - b),
    )
  }

  const pickTls = async (path: 'general.webUiTlsCertPath' | 'general.webUiTlsKeyPath') => {
    const chosen = await pickFile({
      title: t('page.settings.webui.pickTls', '选择证书或私钥文件'),
      filters: TLS_FILTERS,
      properties: ['openFile'],
    })
    if (chosen) onSave(path, chosen)
  }

  const emptyFile = t('page.settings.webui.fileUnset', '未选择')
  const protocol = settings.general.webUiProtocol ?? 'https'
  const bind = settings.general.webUiBind ?? 'lan'
  const scheme = (status?.protocol || protocol).toUpperCase()

  const copyUrl = (url: string) => {
    void navigator.clipboard.writeText(url)
    toast.success(t('page.settings.webui.copied', '已复制访问地址'))
  }

  return (
    <Section title={t('page.settings.webui.title', '本机 WebUI')}>
      <SelectSettingRow
        path="general.webUiMode"
        label={t('page.settings.webui.mode', '开关')}
        description={t(
          'page.settings.webui.modeDesc',
          '关闭 / 长期开启 / 按周定时开启。默认关闭。',
        )}
        value={settings.general.webUiMode ?? 'off'}
        options={[
          { value: 'off', label: t('page.settings.webui.off', '关闭') },
          { value: 'always', label: t('page.settings.webui.always', '长期开启') },
          { value: 'scheduled', label: t('page.settings.webui.scheduled', '定时开启') },
        ]}
        onSave={onSave}
      />

      <NumberSettingRow
        path="general.webUiPort"
        label={t('page.settings.webui.port', '端口')}
        description={t('page.settings.webui.portDesc', '默认 18765，被占用时自动顺延')}
        value={settings.general.webUiPort ?? 18765}
        min={1024}
        max={65535}
        step={1}
        onSave={onSave}
        invalidToast={t('toast.settings.webUiPortInvalid', '请输入 1024-65535 之间的整数')}
      />

      {settings.general.webUiMode === 'scheduled' && (
        <>
          <SettingRow
            path="general.webUiScheduleStart"
            label={t('page.settings.webui.window', '时段')}
            description={t('page.settings.webui.windowDesc', 'HH:mm，结束早于开始则视为跨午夜')}
          >
            <div className="flex items-center gap-2">
              <input
                type="time"
                className={cn(INPUT_SM, 'w-28')}
                value={settings.general.webUiScheduleStart ?? '08:00'}
                onChange={(e) => onSave('general.webUiScheduleStart', e.target.value)}
              />
              <span className="text-xs text-gray-400">–</span>
              <input
                type="time"
                className={cn(INPUT_SM, 'w-28')}
                value={settings.general.webUiScheduleEnd ?? '22:00'}
                onChange={(e) => onSave('general.webUiScheduleEnd', e.target.value)}
              />
            </div>
          </SettingRow>
          <SettingRow
            path="general.webUiScheduleDays"
            label={t('page.settings.webui.days', '星期')}
            description={t('page.settings.webui.daysDesc', '选中的星期在上述时段内开启')}
          >
            <div className="flex flex-wrap gap-1">
              {DAYS.map((d) => {
                const on = days.includes(d.id)
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={cn(
                      btnStyle('secondary'),
                      'text-xs px-2 py-1',
                      on && 'bg-blue-500/15 border-blue-500/40 text-blue-600 dark:text-blue-400',
                    )}
                    onClick={() => toggleDay(d.id)}
                  >
                    {t(d.key, d.fallback)}
                  </button>
                )
              })}
            </div>
          </SettingRow>
        </>
      )}

      <SettingRow
        path="general.webUiStatus"
        label={t('page.settings.webui.status', '状态')}
        description={
          status?.listening
            ? t('page.settings.webui.listeningOn', '正在监听 {host} ({scheme})')
                .replace('{host}', status.listenHost)
                .replace('{scheme}', scheme)
            : t('page.settings.webui.stopped', '未监听')
        }
      >
        <div className="flex flex-col items-end gap-1.5 max-w-md">
          {status?.error && <span className="text-xs text-red-500">{status.error}</span>}
          {status?.listening && status.urls[0] && (
            <>
              <code className="text-[11px] break-all text-right text-gray-500 dark:text-gray-400">
                {status.urls.find((u) => u.includes('127.0.0.1')) || status.urls[0]}
              </code>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={cn(btnStyle('secondary'), 'text-xs')}
                  onClick={() => {
                    const url = status.urls.find((u) => u.includes('127.0.0.1')) || status.urls[0]
                    copyUrl(url)
                  }}
                >
                  {t('page.settings.webui.copy', '复制地址')}
                </button>
                <button
                  type="button"
                  className={cn(btnStyle('secondary'), 'text-xs')}
                  onClick={async () => {
                    const r = await getAPI().sys.openWebUi()
                    if (!r.success) toast.error(r.error || 'open failed')
                  }}
                >
                  {t('page.settings.webui.open', '在浏览器打开')}
                </button>
              </div>
            </>
          )}
          {status?.listening && bind !== 'loopback' && (
            <span className="text-[10px] text-gray-400 text-right break-all">
              {status.lanIpv6[0]
                ? `${t('page.settings.webui.ipv6Auto', '已探测局域网 IPv6')} ${status.lanIpv6[0].replace(/\?k=.*/, '')}`
                : status.ipv6
                  ? t('page.settings.webui.ipv6None', '未探测到局域网 IPv6，已跳过链路本地地址')
                  : t('page.settings.webui.ipv6Off', 'IPv6 已关闭，仅 IPv4')}
            </span>
          )}
        </div>
      </SettingRow>

      <SelectSettingRow
        path="general.webUiProtocol"
        label={t('page.settings.webui.protocol', '协议')}
        description={
          protocol === 'http'
            ? t(
                'page.settings.webui.protocolHttpDesc',
                '明文 HTTP。局域网里别人抓包能看到令牌，只适合完全信任的网。',
              )
            : t(
                'page.settings.webui.protocolHttpsDesc',
                'HTTPS，TLS 1.2 / 1.3。自签证书首次打开需在浏览器信任。推荐。',
              )
        }
        value={protocol}
        options={[
          { value: 'https', label: t('page.settings.webui.https', 'HTTPS（推荐）') },
          { value: 'http', label: t('page.settings.webui.http', 'HTTP') },
        ]}
        onSave={onSave}
      />

      <SelectSettingRow
        path="general.webUiBind"
        label={t('page.settings.webui.bind', '访问范围')}
        description={
          bind === 'loopback'
            ? t('page.settings.webui.bindLoopbackDesc', '只有这台电脑的浏览器能打开。')
            : bind === 'all'
              ? t(
                  'page.settings.webui.bindAllDesc',
                  '监听全部网卡，含公网地址。路由器若做了端口转发，外网也能连——不推荐。',
                )
              : t(
                  'page.settings.webui.bindLanDesc',
                  '局域网可全面访问。公网来源、陌生 IPv6 前缀会被拒绝。',
                )
        }
        value={bind}
        options={[
          { value: 'lan', label: t('page.settings.webui.bindLan', '局域网（推荐）') },
          { value: 'loopback', label: t('page.settings.webui.bindLoopback', '仅本机') },
          { value: 'all', label: t('page.settings.webui.bindAll', '全部接口') },
        ]}
        onSave={onSave}
      />

      <ToggleSettingRow
        path="general.webUiIpv6"
        label={t('page.settings.webui.ipv6', 'IPv6')}
        description={t(
          'page.settings.webui.ipv6Desc',
          '双栈监听。局域网 IPv6 只放行本机同 /64 前缀，链路本地地址不对外展示。',
        )}
        value={settings.general.webUiIpv6 !== false}
        onSave={onSave}
      />

      <SettingRow
        path="general.webUiToken"
        label={t('page.settings.webui.token', '访问令牌')}
        description={t(
          'page.settings.webui.tokenDesc',
          '256-bit，加密保存在本机。页面、接口、WebSocket 都要带它。不会自动更换；链接泄露时再点刷新。',
        )}
      >
        <div className="flex flex-col items-end gap-1.5 max-w-md">
          <code className="text-[11px] break-all text-right text-gray-500 dark:text-gray-400">
            {status?.accessToken
              ? showToken
                ? status.accessToken
                : maskToken(status.accessToken)
              : '—'}
            {status?.tokenBits ? ` · ${status.tokenBits}-bit` : ''}
          </code>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className={cn(btnStyle('secondary'), 'text-xs')}
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken
                ? t('page.settings.webui.tokenHide', '隐藏')
                : t('page.settings.webui.tokenShow', '显示')}
            </button>
            <button
              type="button"
              className={cn(btnStyle('secondary'), 'text-xs')}
              onClick={() => {
                if (!status?.accessToken) return
                void navigator.clipboard.writeText(status.accessToken)
                toast.success(t('page.settings.webui.tokenCopied', '已复制令牌'))
              }}
            >
              {t('page.settings.webui.copyToken', '复制令牌')}
            </button>
            <button
              type="button"
              className={cn(btnStyle('secondary'), 'text-xs')}
              onClick={async () => {
                const r = await getAPI().sys.regenerateWebUiToken()
                if (!r.success) {
                  toast.error(r.error || 'regen failed')
                  return
                }
                await refresh()
                toast.success(t('page.settings.webui.tokenRegenOk', '已换新令牌，旧链接失效'))
              }}
            >
              {t('page.settings.webui.tokenRegen', '刷新令牌')}
            </button>
          </div>
        </div>
      </SettingRow>

      <SettingRow
        path="general.webUiAuth"
        label={t('page.settings.webui.auth', '认证方式')}
        description={t(
          'page.settings.webui.authDesc',
          '地址栏 ?k=、Cookie（首次打开后记住）、Authorization: Bearer 三者等价。失败 12 次锁定 30 秒。',
        )}
      >
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t('page.settings.webui.authToken', '访问令牌（URL / Cookie / Bearer）')}
        </span>
      </SettingRow>

      <SettingRow
        path="general.webUiAdvanced"
        label={t('page.settings.webui.advanced', '高级')}
        description={t(
          'page.settings.webui.advancedDesc',
          '自定义 HTTPS 证书和私钥。默认收起，空则用自签证书。',
        )}
      >
        <button
          type="button"
          className={cn(btnStyle('secondary'), 'text-xs')}
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced
            ? t('page.settings.webui.advancedHide', '收起')
            : t('page.settings.webui.advancedShow', '展开')}
        </button>
      </SettingRow>
      {advanced && (
        <>
          <SettingRow
            path="general.webUiTlsCertPath"
            label={t('page.settings.webui.tlsCert', '证书')}
            description={t(
              'page.settings.webui.tlsCertDesc',
              '局域网 HTTPS 用。支持 pem / crt / cer / der，也可选同一份捆绑文件。HTTP 协议下不使用。',
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className="text-[11px] text-gray-400 max-w-[10rem] truncate"
                title={settings.general.webUiTlsCertPath}
              >
                {fileLabel(settings.general.webUiTlsCertPath ?? '', emptyFile)}
              </span>
              <button
                type="button"
                className={cn(btnStyle('secondary'), 'text-xs')}
                onClick={() => void pickTls('general.webUiTlsCertPath')}
              >
                {t('page.settings.webui.pickFile', '选择文件')}
              </button>
            </div>
          </SettingRow>
          <SettingRow
            path="general.webUiTlsKeyPath"
            label={t('page.settings.webui.tlsKey', '私钥')}
            description={t(
              'page.settings.webui.tlsKeyDesc',
              'pem / key / der / pkcs8。仅 HTTPS 使用。',
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className="text-[11px] text-gray-400 max-w-[10rem] truncate"
                title={settings.general.webUiTlsKeyPath}
              >
                {fileLabel(settings.general.webUiTlsKeyPath ?? '', emptyFile)}
              </span>
              <button
                type="button"
                className={cn(btnStyle('secondary'), 'text-xs')}
                onClick={() => void pickTls('general.webUiTlsKeyPath')}
              >
                {t('page.settings.webui.pickFile', '选择文件')}
              </button>
            </div>
          </SettingRow>
          {status?.usingCustomCert && (
            <p className="text-[10px] text-gray-400 text-right px-5 py-2">
              {t('page.settings.webui.customCertOn', '当前网关使用自定义证书')}
            </p>
          )}
        </>
      )}
    </Section>
  )
}
