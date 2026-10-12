// DOMを作る補助。文字列は必ずテキストノードとして追加し、innerHTML は使わない(XSS対策)。

/**
 * 要素を作る。
 * - on... で始まる属性はイベントリスナー(例: onclick)
 * - class は className、value は(子要素の追加後に)value プロパティ
 * - false / null / undefined の属性・子要素は無視する
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [key, val] of Object.entries(attrs ?? {})) {
    if (val === undefined || val === null || val === false) continue;
    if (key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2), val);
    else if (key === 'class') el.className = val;
    else if (key === 'value') value = val;
    else el.setAttribute(key, val === true ? '' : String(val));
  }
  append(el, children);
  if (value !== undefined) el.value = String(value); // select は、option を追加した後に値を設定する
  return el;
}

export function append(parent, children) {
  for (const child of [children].flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/**
 * 自前で生成したSVGの文字列を、DOMの要素にする(innerHTML を使わない)。
 * 値のエスケープ済みの文字列(public/js/charts.js の出力)だけを渡すこと。
 */
export function svgFromString(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'svg' || doc.querySelector('parsererror')) {
    throw new Error('SVGを解析できません');
  }
  // スクリプト・イベント属性は含まれないはずだが、念のため取り除く
  root.querySelectorAll('script, foreignObject').forEach((n) => n.remove());
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) if (attr.name.toLowerCase().startsWith('on')) el.removeAttribute(attr.name);
  }
  return document.importNode(root, true);
}

export function replace(parent, ...children) {
  parent.replaceChildren();
  append(parent, children);
  return parent;
}
