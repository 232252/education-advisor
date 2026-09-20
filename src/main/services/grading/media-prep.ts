// =============================================================
// Media Prep — 入模图片统一降采样(控 token)
// 直读图片 / PDF 栅格化页 / docx 内嵌图 / zip 抽出图,进模型前
// 一律过 downscaleToAiJpeg: 长边 ≤ maxEdge(默认 1600,与套打母版
// 标定 template-calibrate 的 MAX_AI_IMAGE_PX 同口径) + JPEG 重编码。
// 解码/编码失败返回原图,不阻断摄取(坏图交给调用方的上限/张数约束兜底)。
// =============================================================

export interface PreparedImage {
  /** base64 */
  data: string
  mimeType: string
}

/** 送 AI 的图片长边上限(与 template-calibrate.MAX_AI_IMAGE_PX 同值) */
export const MAX_AI_IMAGE_EDGE = 1600

/** JPEG 重编码质量(与 template-calibrate.toAiJpeg 一致) */
const JPEG_QUALITY = 0.85

/**
 * 图片字节 → 送 AI 的 JPEG: 白底重绘 + 等比缩放(长边 ≤ maxEdge) +
 * JPEG 重编码;已小于 maxEdge 的图也重编码(统一 mime,顺带压掉 PNG 体积)。
 * loadImage/toBuffer 任一步失败(损坏图/不支持格式)→ 原样返回不抛错。
 */
export async function downscaleToAiJpeg(
  buf: Buffer,
  mimeType: string,
  maxEdge: number = MAX_AI_IMAGE_EDGE,
): Promise<PreparedImage> {
  try {
    const { loadImage, createCanvas } = await import('@napi-rs/canvas')
    const img = await loadImage(buf)
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = createCanvas(w, h)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return {
      data: canvas.toBuffer('image/jpeg', JPEG_QUALITY).toString('base64'),
      mimeType: 'image/jpeg',
    }
  } catch {
    // 解码/重编码失败不阻断: 原图直发(调用方的 maxImages/字节上限仍生效)
    return { data: buf.toString('base64'), mimeType }
  }
}
