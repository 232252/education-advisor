import * as React from 'react';
import { IM_LOCALE_NAMESPACE } from './i18n.js';

export const IM_MAIN_PANEL_ID = 'xmanrui-dsh-im';
const h = React.createElement;

function OpenImAction({ subject, packageName, onOpen, t }) {
  if (subject?.kind !== 'bundle' && subject?.kind !== 'row') return null;
  if (subject.pkg?.name !== packageName) return null;
  if (subject.kind === 'row' && subject.row?.moduleName !== packageName) return null;
  return h('button', {
    type: 'button', className: 'dim-pluginOpen', onClick: onOpen,
  }, t('打开 IM机器人'));
}

function ImPluginPage({ renderPanel, onBack, t }) {
  return h('div', { className: 'dim-pluginPage' },
    h('div', { className: 'dim-pluginPageContent' },
      h('button', { type: 'button', className: 'dim-pluginBack', onClick: onBack },
        h('span', { 'aria-hidden': true }, '‹'), t('返回插件详情')),
      renderPanel()));
}

// Optional services and slots keep the existing settings entry working on
// older DSH versions. Reuse the same panel through public navigation APIs.
export function installImPluginPage(ctx, { packageName, renderPanel }) {
  if (typeof ctx.inject !== 'function') return;
  ctx.inject(['layout', 'pluginNavigation'], (pageCtx) =>
    pageCtx.slots.inject('main', () => {
      const unregisterPage = pageCtx.slots.register({
        name: 'main', key: IM_MAIN_PANEL_ID, locale: IM_LOCALE_NAMESPACE,
        inject: () => ({
          renderPanel,
          onBack: () => pageCtx.pluginNavigation.openBundle(packageName),
        }),
      }, ImPluginPage);
      const stopActions = pageCtx.slots.inject('plugins.detail.actions', () =>
        pageCtx.slots.register({
          name: 'plugins.detail.actions', id: 'xmanrui-dsh-im-open',
          order: 20, locale: IM_LOCALE_NAMESPACE,
          inject: () => ({
            packageName,
            onOpen: () => pageCtx.layout.selectPanel(IM_MAIN_PANEL_ID),
          }),
        }, OpenImAction));
      return () => {
        stopActions();
        unregisterPage();
      };
    }));
}
