// =============================================================
// EAA Bridge — 初始化辅助
// reason-codes.json 转换复制 + doctor 健康检查
// 从 eaa-bridge.ts EAABridge.initialize 下沉(纯重构,逻辑逐字搬移)
// =============================================================

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { convertReasonCodes } from './legacy-migration'

/**
 * 计算项目内 reason-codes.json 源路径
 * (提取自 EAABridge.initialize,逻辑逐字保留)。
 * @param mainDir 主进程模块目录(eaa-bridge.ts 的 __dirname,在编排层求值后传入)
 */
export function resolveReasonCodesSource(mainDir: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'config', 'reason-codes.json')
    : path.join(mainDir, '..', '..', 'config', 'reason-codes.json')
}

/**
 * 转换并复制 reason-codes.json (P-fix: project flat schema -> Rust nested schema)
 * 项目根 config/reason-codes.json 是 flat 格式: { CODE: { label, category, delta } }
 * Rust EAA CLI 期望嵌套格式: { version, codes: { CODE: { label, category, score_delta } } }
 * 转换: 读源 JSON -> 包装成 { version, codes: {...} } -> 复制到两处
 * (转换逻辑在 eaa/legacy-migration.ts 的 convertReasonCodes)
 * (提取自 EAABridge.initialize,逻辑逐字保留)
 *
 * @param codesSrc 源文件路径
 * @param schemaCodesDst schema 目录下的目标路径
 * @param codesDst 数据目录下的目标路径(备用路径)
 */
export function seedReasonCodes(codesSrc: string, schemaCodesDst: string, codesDst: string): void {
  if (fs.existsSync(codesSrc) && !fs.existsSync(schemaCodesDst)) {
    try {
      const converted = convertReasonCodes(fs.readFileSync(codesSrc, 'utf-8'))
      fs.writeFileSync(schemaCodesDst, converted, 'utf-8')
      console.log('[EAA] Converted + wrote reason-codes.json to schema dir')
    } catch (err) {
      console.warn('[EAA] Failed to write reason-codes.json to schema dir:', err)
    }
  }

  // 也复制到数据目录（备用路径）
  if (fs.existsSync(codesSrc) && !fs.existsSync(codesDst)) {
    try {
      const converted = convertReasonCodes(fs.readFileSync(codesSrc, 'utf-8'))
      fs.writeFileSync(codesDst, converted, 'utf-8')
      console.log('[EAA] Converted + wrote reason-codes.json to data dir')
    } catch (err) {
      console.warn('[EAA] Failed to write reason-codes.json:', err)
    }
  }
}

/**
 * 运行 doctor 健康检查(提取自 EAABridge.initialize,逻辑逐字保留)。
 * doctor 可能因为数据为空而警告，但不影响使用;
 * doctor 抛错时不阻塞启动——EAA 命令可能在后续成功。
 *
 * @param runDoctor 编排层传入的 doctor 命令执行器(内部走 execute 的完整路径)
 */
export async function runDoctorCheck(
  runDoctor: () => Promise<{ success: boolean; stderr: string; data: unknown }>,
): Promise<{ healthy: boolean; message: string }> {
  try {
    const result = await runDoctor()
    if (result.success) {
      console.log('[EAA] Doctor check passed')
      return { healthy: true, message: 'EAA ready' }
    }
    // doctor 可能因为数据为空而警告，但不影响使用
    console.log('[EAA] Doctor warnings (non-fatal):', result.stderr || JSON.stringify(result.data))
    return { healthy: true, message: 'EAA ready (with warnings)' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[EAA] Doctor check failed:', msg)
    // 不阻塞启动——EAA 命令可能在后续成功
    return { healthy: false, message: msg }
  }
}
