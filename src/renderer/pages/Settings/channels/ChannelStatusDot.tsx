// =============================================================
// ChannelStatusDot — 兼容壳:实现已上提至 components/channel/ChannelStatusBadge
// (连接中心面板与设置页共用五态徽标),旧名保留 re-export 防外部引用断裂。
// =============================================================

export {
  ChannelStatusBadge as ChannelStatusDot,
  useChannelStatusText,
} from '../../../components/channel/ChannelStatusBadge'
