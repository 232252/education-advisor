/** 设置页和侧栏入口打开同一块 IM 面板。 */
export const OPEN_CONNECTION_CENTER = 'eaa:open-connection-center'

export function requestOpenConnectionCenter(): void {
  window.dispatchEvent(new Event(OPEN_CONNECTION_CENTER))
}
