// =============================================================
// EAA Bridge — export 导出格式探测
// 从 eaa-bridge.ts EAABridge.getSupportedExportFormats 下沉
// (纯重构,逻辑逐字搬移)
// =============================================================

import { debug } from '@shared/debug'
import { parseExportFormatsFromHelp } from './output-parser'
import { SUPPORTED_EXPORT_FORMATS } from './types'

/**
 * 动态获取 EAA CLI export 命令支持的导出格式。
 *
 * 实现策略：
 *   1. 若二进制可用，运行 `eaa export --help` 并解析帮助文本中的格式列表
 *   2. 解析失败或二进制不可用时，降级到静态 SUPPORTED_EXPORT_FORMATS
 *
 * 这样当 EAA 升级新增格式时，前端无需改动即可自动适配。
 * (缓存/in-flight 去重由编排层的 cachedExportFormats/exportFormatsInFlight 管理)
 *
 * @param runExportHelp 编排层传入的 `export --help` 执行器
 *   (内部走 execute 的完整路径,不追加 --output json,--help 是 clap 内置)
 */
export async function probeExportFormats(
  runExportHelp: () => Promise<{ success: boolean; data: unknown }>,
): Promise<readonly string[]> {
  try {
    const result = await runExportHelp()

    if (result.success && typeof result.data === 'string') {
      const helpText = result.data
      const formats = parseExportFormatsFromHelp(helpText)
      if (formats.length > 0) {
        if (debug.eaa) {
          console.log('[debug:eaa] dynamically detected export formats:', formats)
        }
        return formats
      }
    }
  } catch (err) {
    console.warn(
      '[EAA] Failed to dynamically probe export formats, using static list:',
      err instanceof Error ? err.message : String(err),
    )
  }

  // 降级到静态列表
  return SUPPORTED_EXPORT_FORMATS
}
