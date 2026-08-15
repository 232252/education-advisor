// =============================================================
// 关闭行为处理 — closeBehavior 设置(tray/exit/ask) + 飞书机器人退出确认
// =============================================================

import { app, type BrowserWindow, dialog } from 'electron'
import { feishuBotService } from '../services/feishu-bot-service'
import { settingsService } from '../services/settings-service'
import { getTrayStatus } from '../services/tray-service'
import { mainState } from './state'

export function handleWindowClose(win: BrowserWindow, event: Electron.Event): void {
  if (mainState.isQuitting) return

  const settings = settingsService.getSettings()
  const behavior = settings.general.closeBehavior

  switch (behavior) {
    case 'tray': {
      // 防御: 托盘不存在时(图标缺失或 minimizeToTray 被关闭)不能隐藏窗口,
      // 否则应用会"消失"且无法恢复 — 回退到询问对话框
      const { exists: trayAlive } = getTrayStatus()
      if (trayAlive) {
        event.preventDefault()
        win.hide()
      } else {
        // 托盘不可用,弹出询问对话框
        event.preventDefault()
        showCloseDialog(win)
      }
      break
    }

    case 'exit':
      // B6-1: 若飞书机器人正在运行,退出会断开其长连接(影响"远程访问")。
      // 先同步阻止关闭,再异步确认。
      event.preventDefault()
      confirmQuitIfNeeded(win)
      break

    default: {
      // 同步阻止关闭，然后异步弹对话框
      event.preventDefault()
      showCloseDialog(win)
      break
    }
  }
}

/** 关闭行为询问对话框（closeBehavior='ask' 或托盘不可用时的回退） */
function showCloseDialog(win: BrowserWindow): void {
  dialog
    .showMessageBox(win, {
      type: 'question',
      title: '关闭窗口',
      message: '您希望如何处理？',
      buttons: ['最小化到托盘', '直接退出', '取消'],
      defaultId: 0,
      cancelId: 2,
      checkboxLabel: '记住选择',
      checkboxChecked: false,
    })
    .then((result) => {
      const buttonIndex = result.response
      const remember = result.checkboxChecked

      if (buttonIndex === 2) {
        // 取消 — 什么都不做
        return
      }

      if (remember) {
        const newBehavior = buttonIndex === 0 ? 'tray' : 'exit'
        settingsService.update('general.closeBehavior', newBehavior)
      }

      if (buttonIndex === 0) {
        // 若托盘不可用则直接退出,不能隐藏到不存在的托盘
        const { exists: trayAlive } = getTrayStatus()
        if (trayAlive) {
          win.hide()
        } else {
          mainState.isQuitting = true
          app.quit()
        }
      } else {
        mainState.isQuitting = true
        app.quit()
      }
    })
    .catch(() => {
      /* dialog cancelled or error */
    })
}

/**
 * B6-1: 真正退出前,若飞书机器人处于连接/连接中状态,弹确认框提醒用户
 * 退出会断开飞书长连接(导致无法再从飞书远程对话)。
 * bot 未运行时直接退出,不打扰用户。
 */
function confirmQuitIfNeeded(win: BrowserWindow): void {
  let botActive = false
  try {
    const st = feishuBotService.getStatus().status
    botActive = st === 'connected' || st === 'connecting'
  } catch {
    botActive = false
  }
  if (!botActive) {
    mainState.isQuitting = true
    app.quit()
    return
  }
  dialog
    .showMessageBox(win, {
      type: 'warning',
      title: '飞书机器人正在运行',
      message: '退出应用将断开飞书机器人的长连接，您将无法再从飞书远程对话。',
      buttons: ['最小化到托盘(保持运行)', '仍然退出', '取消'],
      defaultId: 0,
      cancelId: 2,
    })
    .then((result) => {
      if (result.response === 2) return // 取消
      if (result.response === 0) {
        // 最小化到托盘:若托盘可用则隐藏,否则提示无法最小化
        const { exists: trayAlive } = getTrayStatus()
        if (trayAlive) {
          win.hide()
        } else {
          dialog.showMessageBox(win, {
            type: 'info',
            message: '当前未启用托盘图标，无法最小化到后台。已在“设置”中为您启用最小化到托盘。',
            buttons: ['知道了'],
          })
          settingsService.update('general.minimizeToTray', true)
        }
      } else {
        mainState.isQuitting = true
        app.quit()
      }
    })
    .catch(() => {
      /* dialog cancelled */
    })
}
