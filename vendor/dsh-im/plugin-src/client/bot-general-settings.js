import * as React from 'react';
import { h } from './i18n.js';
import { SET_MESSAGE_MODE_ENDPOINT, normalizeBusyMessageMode } from '../../src/channels/shared/message-mode.mjs';

function modeFromResult(result, botId) {
  if (result?.ok !== true) throw new Error(result?.error?.message || '无法读取消息处理设置，请稍后重试。');
  const bot = result.value?.bots?.find((entry) => entry.botId === botId);
  if (!bot) throw new Error('找不到要修改的机器人。');
  return normalizeBusyMessageMode(bot.busyMessageMode);
}

export function BotGeneralSettingsPage({ account, rpcCall }) {
  const [mode, setMode] = React.useState('queue');
  const [savedMode, setSavedMode] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState(null);
  const mounted = React.useRef(false);

  const load = React.useCallback(async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const value = modeFromResult(await rpcCall('connection.status', {}), account.botId);
      if (!mounted.current) return;
      setMode(value);
      setSavedMode(value);
    } catch (error) {
      if (mounted.current) setFeedback({ error: true, text: error.message });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [account.botId, rpcCall]);

  React.useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  const save = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const value = modeFromResult(await rpcCall(SET_MESSAGE_MODE_ENDPOINT, {
        botId: account.botId, busyMessageMode: mode,
      }), account.botId);
      if (!mounted.current) return;
      setMode(value);
      setSavedMode(value);
      setFeedback({ text: '已保存，对新收到的消息生效。' });
    } catch (error) {
      if (mounted.current) setFeedback({ error: true, text: error.message });
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return h('section', { className: 'dim-accessPage', 'aria-label': '机器人通用设置' },
    h('h2', null, '通用'),
    h('p', null, '以下设置仅影响当前机器人。'),
    h('label', { className: 'dim-accessField' },
      h('span', null, '任务运行时的新消息处理方式'),
      h('select', {
        value: mode, disabled: busy || savedMode === null,
        'aria-label': '任务运行时的新消息处理方式',
        onChange: (event) => { setMode(event.target.value); setFeedback(null); },
      },
      h('option', { value: 'queue' }, '排队（默认）'),
      h('option', { value: 'steer' }, '插话'))),
    h('p', null, mode === 'queue'
      ? '当前任务结束后，再处理新消息。可使用 /steer 手动插话。'
      : '将新的纯文字消息作为补充指令加入当前任务，Agent 在下一步读取。'),
    h('p', null, '没有正在运行的任务时，正常开始新任务。图片、文件、语音和带引用的消息按原有方式处理。'),
    h('button', {
      type: 'button', className: 'dim-deliveryButton', 'data-kind': 'primary',
      disabled: busy || savedMode === null || mode === savedMode,
      onClick: () => void save(),
    }, busy ? '处理中…' : '保存'),
    savedMode === null && !busy ? h('button', {
      type: 'button', className: 'dim-deliveryButton', onClick: () => void load(),
    }, '重新读取') : null,
    feedback ? h('p', { className: 'dim-targetFeedback', role: feedback.error ? 'alert' : 'status' }, feedback.text) : null);
}
