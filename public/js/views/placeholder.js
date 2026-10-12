import { h } from '../dom.js';

/** まだ実装していない画面(集計・マスタ管理は次のリリースで追加する)と、存在しない画面。 */
export async function renderPlaceholder(ctx, route, title) {
  const missing = route.name === 'notfound';
  return h('div', {},
    h('h2', {}, title),
    h('div', { class: 'panel' },
      h('p', {}, missing ? '画面が見つかりません。' : 'この画面は、次のリリースで追加します。'),
      h('a', { href: '#/inquiries' }, '一覧へ戻る')));
}
