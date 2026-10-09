/**
 * 设置页「显示图片」在对话里的当前值。
 * 应用启动时读一次，设置页保存后立刻更新，已打开的对话不用重进。
 */
import { useSyncExternalStore } from 'react'

let showImages = true
const listeners = new Set<() => void>()

export function getShowChatImages(): boolean {
  return showImages
}

export function setShowChatImages(value: boolean): void {
  if (showImages === value) return
  showImages = value
  for (const listener of listeners) listener()
}

export function subscribeShowChatImages(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useShowChatImages(): boolean {
  return useSyncExternalStore(subscribeShowChatImages, getShowChatImages, getShowChatImages)
}
