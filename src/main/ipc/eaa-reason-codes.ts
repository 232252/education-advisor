// =============================================================
// EAA 原因码 (reason-codes) 缓存 — re-export 统一实现
// 权威实现已移至 src/main/services/eaa/reason-codes.ts(services 层的
// addEventTool 参数组装也依赖它),本文件保持原路径与导出名不变
// (ipc/eaa/commands.ts 与 tests 依赖此路径)。
// =============================================================

export {
  getReasonCodeDef,
  lookupReasonCodeDelta,
  resetReasonCodesCache,
} from '../services/eaa/reason-codes'
