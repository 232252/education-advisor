// =============================================================
// QrCode — uqr renderSVG 封装(白衬底二维码卡)
// uqr 输出仅含 viewBox 的 SVG,经容器宽高等比缩放([&>svg] 子选择器铺满);
// 黑白配色与主题无关,深色面板上必须保留白色衬底保证扫码对比度。
// 内容为本地生成的可信 SVG 字符串,无用户可控标记,直接注入无注入面。
// =============================================================

import { useMemo } from 'react'
import { renderSVG } from 'uqr'
import { cn } from '../../lib/ui-utils'

interface QrCodeProps {
  value: string
  /** QR 本体尺寸(px),含 uqr border=2 模块白边 */
  size?: number
  className?: string
}

export function QrCode({ value, size = 128, className }: QrCodeProps) {
  const svg = useMemo(() => renderSVG(value, { ecc: 'M', border: 2 }), [value])
  return (
    <div
      role="img"
      aria-label="QR code"
      className={cn(
        'bg-white rounded-lg overflow-hidden [&>svg]:block [&>svg]:w-full [&>svg]:h-full',
        className,
      )}
      style={{ width: size, height: size }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: 内容为 uqr 对本地 URL 编码生成的可信静态 SVG,无用户可控标记
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
