// グラフ(SVG)の生成。外部ライブラリなし。ブラウザ(画面)とサーバー(月次保存)で共有する。
// 値は数字のラベルで併記し、色だけで区別しない(A-04 は塗りつぶしと斜線のパターンで区別する)。
import { REPORTS } from './report-tables.js';

const FONT = '"Yu Gothic UI", "Meiryo", "Hiragino Sans", sans-serif';
const BAR = '#3b6fd8';
const BAR_LIGHT = '#8aa8e8';
const TEXT = '#1f2933';
const AXIS = '#8a94a3';

const WIDTH = 520;
const MAX_LABEL_CHARS = 14;

/** XML(SVG)に埋め込む文字列をエスケープする。 */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const truncate = (s) => {
  const chars = [...String(s)];
  return chars.length > MAX_LABEL_CHARS ? `${chars.slice(0, MAX_LABEL_CHARS - 1).join('')}…` : chars.join('');
};

function text(x, y, content, { anchor = 'start', size = 12, weight = 400, fill = TEXT } = {}) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family='${FONT}' font-size="${size}" ` +
    `font-weight="${weight}" fill="${fill}">${escapeXml(content)}</text>`;
}

/** 全体を <svg> で包む。standalone なら、単体のファイルとして開ける形(XML宣言つき)にする。 */
function wrap({ title, height, body, standalone, idPrefix }) {
  const id = `${idPrefix}-title`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" ` +
    `role="img" aria-labelledby="${id}"><title id="${id}">${escapeXml(title)}</title>` +
    `<rect width="${WIDTH}" height="${height}" fill="#ffffff"/>${body}</svg>`;
  return standalone ? `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n` : svg;
}

const headingOf = (title, heading) => (heading ? text(12, 22, title, { size: 14, weight: 700 }) : '');
const topOf = (heading) => (heading ? 38 : 10);

function emptyChart(opts) {
  const { title, heading, standalone, idPrefix } = opts;
  const top = topOf(heading);
  return wrap({
    title, height: top + 50, standalone, idPrefix,
    body: headingOf(title, heading) + text(WIDTH / 2, top + 28, 'データなし', { anchor: 'middle', fill: AXIS }),
  });
}

/**
 * 横棒グラフ。
 * @param {Array<{label: string, value: number, text?: string}>} items
 * @param {{title: string, heading?: boolean, standalone?: boolean, idPrefix?: string}} options
 */
export function barChart(items, options) {
  const opts = { heading: true, standalone: false, idPrefix: 'chart', ...options };
  if (items.length === 0) return emptyChart(opts);
  const rowH = 30;
  const padL = 150;
  const padR = 70;
  const top = topOf(opts.heading);
  const max = Math.max(1, ...items.map((i) => i.value));
  const innerW = WIDTH - padL - padR;
  let body = headingOf(opts.title, opts.heading);
  items.forEach((it, n) => {
    const y = top + n * rowH;
    const w = Math.round((innerW * it.value) / max);
    body += text(padL - 8, y + 17, truncate(it.label), { anchor: 'end' });
    body += `<rect x="${padL}" y="${y}" width="${w}" height="22" fill="${BAR}"/>`;
    body += text(padL + w + 6, y + 17, it.text ?? String(it.value));
  });
  return wrap({ ...opts, height: top + items.length * rowH + 8, body });
}

/**
 * 棒グラフ(完了・未完了の2本)。
 * @param {Array<{label: string, done: number, open: number}>} items
 */
export function groupedBarChart(items, options) {
  const opts = { heading: true, standalone: false, idPrefix: 'chart', ...options };
  if (items.length === 0) return emptyChart(opts);
  const rowH = 50;
  const padL = 150;
  const padR = 50;
  const top = topOf(opts.heading) + 24; // 凡例の分
  const max = Math.max(1, ...items.flatMap((i) => [i.done, i.open]));
  const innerW = WIDTH - padL - padR;
  const patternId = `${opts.idPrefix}-hatch`;
  let body = headingOf(opts.title, opts.heading);
  body += `<defs><pattern id="${patternId}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="6" height="6" fill="#ffffff"/><rect width="3" height="6" fill="${BAR_LIGHT}"/></pattern></defs>`;
  // 凡例
  const ly = topOf(opts.heading) + 2;
  body += `<rect x="${padL}" y="${ly}" width="14" height="14" fill="${BAR}"/>` + text(padL + 20, ly + 12, '完了');
  body += `<rect x="${padL + 70}" y="${ly}" width="14" height="14" fill="url(#${patternId})" stroke="${BAR}"/>` +
    text(padL + 90, ly + 12, '未完了');
  items.forEach((it, n) => {
    const y = top + n * rowH;
    const wd = Math.round((innerW * it.done) / max);
    const wo = Math.round((innerW * it.open) / max);
    body += text(padL - 8, y + 20, truncate(it.label), { anchor: 'end' });
    body += `<rect x="${padL}" y="${y}" width="${wd}" height="18" fill="${BAR}"/>`;
    body += text(padL + wd + 6, y + 14, String(it.done));
    body += `<rect x="${padL}" y="${y + 22}" width="${wo}" height="18" fill="url(#${patternId})" stroke="${BAR}"/>`;
    body += text(padL + wo + 6, y + 36, String(it.open));
  });
  return wrap({ ...opts, height: top + items.length * rowH + 8, body });
}

/**
 * 折れ線グラフ。
 * @param {Array<{label: string, value: number}>} items
 */
export function lineChart(items, options) {
  const opts = { heading: true, standalone: false, idPrefix: 'chart', ...options };
  if (items.length === 0) return emptyChart(opts);
  const padL = 40;
  const padR = 24;
  const padB = 36;
  const top = topOf(opts.heading) + 18; // 値のラベルの分
  const plotH = 160;
  const height = top + plotH + padB;
  const max = Math.max(1, ...items.map((i) => i.value));
  const step = items.length > 1 ? (WIDTH - padL - padR - 20) / (items.length - 1) : 0;
  const pts = items.map((it, n) => [padL + 10 + n * step, top + plotH - (plotH * it.value) / max]);
  let body = headingOf(opts.title, opts.heading);
  body += `<line x1="${padL}" y1="${top + plotH}" x2="${WIDTH - padR}" y2="${top + plotH}" stroke="${AXIS}"/>`;
  body += `<line x1="${padL}" y1="${top}" x2="${padL}" y2="${top + plotH}" stroke="${AXIS}"/>`;
  body += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${BAR}" stroke-width="2"/>`;
  pts.forEach((p, n) => {
    body += `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${BAR}"/>`;
    body += text(p[0], p[1] - 9, String(items[n].value), { anchor: 'middle' });
    body += text(p[0], top + plotH + 18, items[n].label, { anchor: 'middle' });
  });
  return wrap({ ...opts, height, body });
}

/**
 * 集計の種類(a01〜a06)と集計結果から、グラフのSVGを作る。
 * @param {string} type 'a01' 〜 'a06'
 * @param {object} summary GET /api/reports/summary の結果
 * @param {{title?: string, heading?: boolean, standalone?: boolean, idPrefix?: string}} [options]
 */
export function renderReportChart(type, summary, options = {}) {
  const def = REPORTS[type];
  if (!def) throw new RangeError(`不明な集計の種類です: ${type}`);
  const chart = def.chart(summary);
  const opts = { title: `${def.code} ${def.title}`, idPrefix: `chart-${type}`, ...options };
  if (chart.kind === 'grouped') return groupedBarChart(chart.items, opts);
  if (chart.kind === 'line') return lineChart(chart.items, opts);
  return barChart(chart.items, opts);
}
