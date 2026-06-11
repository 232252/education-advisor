// =============================================================
// hooks 统一导出
// =============================================================

// P5: 隐私脱敏的 EAA 事件 hook — 事件流中的学生名按隐私引擎脱敏
export {
  type AnonymizedRecord,
  type UseAnonymizedEAAEventsResult,
  useAnonymizedEAAEvents,
} from './useAnonymizedEAAEvents'
export { type AsyncState, useAsync } from './useAsync'
export { useAutoDismiss } from './useAutoDismiss'
export { useDebounce } from './useDebounce'
// P2-6: EAA 数据变更广播 Hook — 让页面在事件写入后实时刷新
export {
  type EAAChangeRecord,
  type EAAChangeType,
  type UseEAAEventsResult,
  useEAAEvents,
} from './useEAAEvents'
export { useEventListener } from './useEventListener'
// U-11: 飞书发送 + 隐私预检复用 hook — 单例对话框,异步 send 等待用户决策
export {
  type FeishuSendParams,
  type FeishuSendResult,
  type UseFeishuPreflightReturn,
  useFeishuPreflight,
} from './useFeishuPreflight'
export { useInterval } from './useInterval'
export { useLocalStorage } from './useLocalStorage'
// P4-2: 跨页面导航 hook — 集中管理路由跳转
export { type UseNavigationResult, useNavigation } from './useNavigation'
export { usePrevious } from './usePrevious'
// P1-2: 隐私过滤 Hook — 让隐私引擎真正在展示层生效
export { type UsePrivacyFilterResult, usePrivacyFilter } from './usePrivacyFilter'
export { useTheme } from './useTheme'
export { useThrottle } from './useThrottle'
export { useToggle } from './useToggle'
