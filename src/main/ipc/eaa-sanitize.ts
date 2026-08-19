// =============================================================
// @deprecated 请直接 import '../utils/sanitize'(本文件为兼容旧路径的 re-export shim)
// EAA 参数 sanitize 纯函数 — re-export 统一实现
// 权威实现已移至 src/main/utils/sanitize.ts(消除 4 份漂移副本),
// 本文件保持原路径与导出名不变(tests 与各域 handler 依赖此路径)。
// 安全关键:防止命令注入 / 路径遍历 / 控制字符注入
// =============================================================

export { sanitizeClassId, sanitizeFreeText, sanitizeName, tokenizeQuery } from '../utils/sanitize'
