// =============================================================
// Class 参数校验 — 班级/学生名/class_id sanitize
// re-export 统一实现(src/main/utils/sanitize.ts),消除本地漂移副本。
// 班级/学生名保持与 EAA 协议一致以避免 IPC 参数异常;
// 统一版额外拒绝 / 与 .. 序列(与 eaa 域一致的安全收敛)。
// =============================================================

export { sanitizeClassId, sanitizeName } from '../../utils/sanitize'
