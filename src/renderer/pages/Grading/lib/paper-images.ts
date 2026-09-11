// =============================================================
// paper-images — 试卷扫描件 data URL 加载(复核台 / 批阅痕迹打印共用)
// 按 paperId+storedName 缓存,避免同一份卷反复走 IPC。
// =============================================================

import type { GradingPaper } from '@shared/types'
import { getAPI } from '../../../lib/ipc-client'

/** base64 → data URL 缓存(paperId:storedName → url) */
const imageUrlCache = new Map<string, string>()

export async function loadPaperImageUrls(
  taskId: string,
  paper: Pick<GradingPaper, 'id' | 'files'>,
): Promise<string[]> {
  const urls: string[] = []
  for (const f of paper.files) {
    const cacheKey = `${paper.id}:${f.storedName}`
    let url = imageUrlCache.get(cacheKey)
    if (!url) {
      const r = await getAPI().grading.readPaperFile(taskId, f.storedName)
      if (!r.success || !r.data) continue
      url = `data:${r.data.mime};base64,${r.data.base64}`
      imageUrlCache.set(cacheKey, url)
    }
    urls.push(url)
  }
  return urls
}
