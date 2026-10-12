import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barChart, escapeXml, groupedBarChart, lineChart, renderReportChart } from '../public/js/charts.js';
import { formatMinutes, REPORT_TYPES, REPORTS } from '../public/js/report-tables.js';

const summary = {
  period: { from: '2026-07-01', to: '2026-09-30' },
  a01: [{ category: 'PC・ネットワーク', count: 4 }, { category: 'アカウント・権限', count: 2 }],
  a02: [{ dept: '営業', count: 5 }],
  a03: [{ category: 'PC・ネットワーク', doneCount: 3, avgMinutes: 285 }, { category: '備品', doneCount: 0, avgMinutes: null }],
  a04: [{ assignee: '山田 太郎', done: 2, open: 1 }, { assignee: '未割当', done: 0, open: 2 }],
  a05: [{ month: '2026-07', count: 2 }, { month: '2026-08', count: 0 }, { month: '2026-09', count: 3 }],
  a06: [{ status: '未対応', count: 2 }, { status: '完了', count: 5 }],
};

test('XMLエスケープ: & < > " \' を置き換える', () => {
  assert.equal(escapeXml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
});

test('棒グラフ: ラベルと値の数字を含み、単体のSVGとして開ける', () => {
  const svg = barChart([{ label: 'PC', value: 4 }, { label: '備品', value: 0 }], { title: 'カテゴリ別', standalone: true });
  assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /role="img"/);
  assert.match(svg, /<title id="chart-title">カテゴリ別<\/title>/);
  assert.match(svg, />PC<\/text>/);
  assert.match(svg, />4<\/text>/);
  assert.match(svg, />0<\/text>/);
  assert.ok(svg.trimEnd().endsWith('</svg>'));
});

test('棒グラフ: 値が最大の棒が最も長く、0は幅0', () => {
  const svg = barChart([{ label: 'a', value: 10 }, { label: 'b', value: 5 }, { label: 'c', value: 0 }], { title: 't' });
  const widths = [...svg.matchAll(/<rect x="150" y="\d+" width="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(widths.length, 3);
  assert.ok(widths[0] > widths[1] && widths[1] > widths[2]);
  assert.equal(widths[2], 0);
  assert.ok(Math.abs(widths[0] - 2 * widths[1]) <= 1);
});

test('棒グラフ: 表示用のテキスト(平均対応時間など)を値の代わりに出せる', () => {
  const svg = barChart([{ label: 'PC', value: 285, text: '4:45' }], { title: 't' });
  assert.match(svg, />4:45<\/text>/);
});

test('グラフ: 入力値は XML エスケープされ、タグとして解釈されない', () => {
  const svg = barChart([{ label: '<script>alert(1)</script>&', value: 1 }], { title: '"A" & <B>' });
  assert.ok(!svg.includes('<script>'));
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /&amp;/);
  assert.match(svg, /&quot;A&quot; &amp; &lt;B&gt;/);
});

test('グラフ: 長いラベルは省略される', () => {
  const svg = barChart([{ label: 'あ'.repeat(30), value: 1 }], { title: 't' });
  assert.ok(!svg.includes('あ'.repeat(30)));
  assert.match(svg, /あ{13}…/);
});

test('グラフ: データが無いときは「データなし」を表示する', () => {
  for (const fn of [barChart, groupedBarChart, lineChart]) {
    const svg = fn([], { title: 't' });
    assert.match(svg, /データなし/);
  }
});

test('棒グラフ(2本): 凡例と、完了・未完了の値を含み、斜線のパターンで区別する', () => {
  const svg = groupedBarChart([{ label: '山田', done: 2, open: 1 }], { title: 't', idPrefix: 'x' });
  assert.match(svg, />完了<\/text>/);
  assert.match(svg, />未完了<\/text>/);
  assert.match(svg, /<pattern id="x-hatch"/);
  assert.match(svg, /fill="url\(#x-hatch\)"/);
  assert.match(svg, />2<\/text>/);
  assert.match(svg, />1<\/text>/);
});

test('折れ線グラフ: 各点の値と月のラベルを含む(0件の月も)', () => {
  const svg = lineChart([{ label: '2026/07', value: 2 }, { label: '2026/08', value: 0 }, { label: '2026/09', value: 3 }], { title: 't' });
  assert.equal((svg.match(/<circle /g) || []).length, 3);
  assert.match(svg, />2026\/08<\/text>/);
  assert.match(svg, /<polyline /);
});

test('折れ線グラフ: 点が1つでも描画できる', () => {
  const svg = lineChart([{ label: '2026/10', value: 7 }], { title: 't' });
  assert.equal((svg.match(/<circle /g) || []).length, 1);
});

test('集計グラフ: a01〜a06 のすべてがSVGになる', () => {
  for (const type of REPORT_TYPES) {
    const svg = renderReportChart(type, summary, { standalone: true });
    assert.match(svg, /<svg /, type);
    assert.match(svg, new RegExp(REPORTS[type].code), type);
  }
  assert.throws(() => renderReportChart('a99', summary), RangeError);
});

test('集計グラフ: 平均対応時間は H:mm、完了0件は - と表示し、棒は0', () => {
  const svg = renderReportChart('a03', summary);
  assert.match(svg, />4:45<\/text>/);
  assert.match(svg, />-<\/text>/);
});

test('集計表: 画面は - 、CSVは空欄で値なしを表す', () => {
  assert.deepEqual(REPORTS.a03.rows(summary), [['PC・ネットワーク', 3, '4:45'], ['備品', 0, '-']]);
  assert.deepEqual(REPORTS.a03.rows(summary, ''), [['PC・ネットワーク', 3, '4:45'], ['備品', 0, '']]);
  assert.equal(formatMinutes(null), '-');
  assert.equal(formatMinutes(0), '0:00');
  assert.equal(formatMinutes(450), '7:30');
});

test('集計表: 月は YYYY/MM で表示する', () => {
  assert.deepEqual(REPORTS.a05.rows(summary)[0], ['2026/07', 2]);
});
