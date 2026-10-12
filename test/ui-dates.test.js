import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from '../public/js/api.js';
import {
  defaultRange, firstOfMonth, formatMonth, isDateText, isMonthText, parseReportRange, previousMonth,
  toDateText, validateRange,
} from '../public/js/dates.js';
import { isDateString, parseDateRange } from '../src/domain/validation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date(2026, 9, 12, 10, 30, 0); // 2026-10-12

test('日付: 実在する日付・月だけが通る(サーバーと同じ判定)', () => {
  for (const ok of ['2026-10-12', '2028-02-29', '2026-01-01']) {
    assert.equal(isDateText(ok), true, ok);
    assert.equal(isDateText(ok), isDateString(ok));
  }
  for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026/10/12', '2026-1-2', '', null, undefined, 20261012]) {
    assert.equal(isDateText(bad), false, String(bad));
    assert.equal(isDateText(bad), isDateString(bad));
  }
  assert.equal(isMonthText('2026-09'), true);
  for (const bad of ['2026-13', '2026-00', '2026-9', '202609', '', null]) assert.equal(isMonthText(bad), false, String(bad));
});

test('既定の期間: 当月1日〜今日', () => {
  assert.equal(firstOfMonth(NOW), '2026-10-01');
  assert.equal(toDateText(NOW), '2026-10-12');
  assert.deepEqual(defaultRange(NOW), { from: '2026-10-01', to: '2026-10-12' });
  // 月初・月末・年始
  assert.deepEqual(defaultRange(new Date(2027, 0, 1)), { from: '2027-01-01', to: '2027-01-01' });
  assert.deepEqual(defaultRange(new Date(2026, 11, 31)), { from: '2026-12-01', to: '2026-12-31' });
});

test('先月: 年またぎ・月初・月末でも正しい', () => {
  assert.equal(previousMonth(NOW), '2026-09');
  assert.equal(previousMonth(new Date(2027, 0, 15)), '2026-12');
  assert.equal(previousMonth(new Date(2026, 2, 31)), '2026-02'); // 3/31 → 2月(31日に存在しない日付でずれない)
  assert.equal(previousMonth(new Date(2028, 2, 1)), '2028-02');
});

test('期間: URLから復元し、不正・未指定は既定値にする', () => {
  assert.deepEqual(parseReportRange('from=2026-07-01&to=2026-09-30', NOW), { from: '2026-07-01', to: '2026-09-30' });
  assert.deepEqual(parseReportRange('', NOW), { from: '2026-10-01', to: '2026-10-12' });
  assert.deepEqual(parseReportRange('from=abc&to=2026-02-30', NOW), { from: '2026-10-01', to: '2026-10-12' });
  assert.deepEqual(parseReportRange('?from=2026-07-01', NOW), { from: '2026-07-01', to: '2026-10-12' });
});

test('期間の検証: 画面とサーバーが、同じ入力に同じ結論と文言を返す', () => {
  const cases = [
    ['2026-07-01', '2026-10-12'], ['2026-10-12', '2026-10-12'], ['2026-10-13', '2026-10-12'],
    ['', '2026-10-12'], ['2026-07-01', ''], ['', ''], ['2026-02-30', '2026-03-01'], ['abc', '2026-03-01'],
  ];
  for (const [from, to] of cases) {
    const client = validateRange(from, to);
    let server = {};
    try {
      parseDateRange({ from, to });
    } catch (e) {
      server = Object.fromEntries(e.fields.map((f) => [f.field, f.message]));
    }
    assert.deepEqual(client, server, `${from} 〜 ${to}`);
  }
});

test('月の表示: YYYY/MM', () => {
  assert.equal(formatMonth('2026-09'), '2026/09');
  assert.equal(formatMonth(undefined), '');
});

test('APIクライアント: 集計・CSV・月次保存・マスタのURLとメソッド', async () => {
  const calls = [];
  const api = createApi({
    getOperatorId: () => 2,
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => '{}' };
    },
  });
  await api.getSummary('2026-07-01', '2026-10-12');
  assert.equal(calls[0].url, '/api/reports/summary?from=2026-07-01&to=2026-10-12');
  assert.equal(calls[0].init.method, 'GET');
  await api.saveMonthly('2026-09');
  assert.equal(calls[1].url, '/api/reports/monthly');
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.body, JSON.stringify({ month: '2026-09' }));
  assert.equal(calls[1].init.headers['X-Operator-Id'], '2');
  await api.updateEmployee(5, { isActive: false });
  assert.equal(calls[2].url, '/api/employees/5');
  assert.equal(calls[2].init.method, 'PATCH');
  await api.updateCategory(3, { name: 'x' });
  assert.equal(calls[3].url, '/api/categories/3');
  await api.createEmployee({ name: 'a' });
  assert.equal(calls[4].init.method, 'POST');
  assert.equal(api.reportCsvUrl('a03', '2026-07-01', '2026-10-12'), '/api/reports/export.csv?type=a03&from=2026-07-01&to=2026-10-12');
  assert.equal(api.monthlyFileUrl('2026-09', 'a01.csv'), '/api/reports/monthly/2026-09/a01.csv');
});

test('画面のコード: DOMParser で挿入するSVGは、自前の生成物だけ(innerHTML を使わない)', () => {
  const dom = fs.readFileSync(path.join(root, 'public', 'js', 'dom.js'), 'utf8');
  assert.match(dom, /new DOMParser\(\)\.parseFromString\(svgText, 'image\/svg\+xml'\)/);
  // 取り除く対象(スクリプト・イベント属性)が書かれている
  assert.match(dom, /script, foreignObject/);
  assert.match(dom, /startsWith\('on'\)/);
});
