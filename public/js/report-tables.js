// 集計表の定義(ブラウザとサーバーで共有する)。
// 画面の表・CSV出力・月次保存のグラフが、同じ定義から作られる。
// 集計結果(summary)の形は docs/api-design.md 5.9 のとおり。

/** 分を 'H:mm' にする(null / undefined は emptyText)。 */
export function formatMinutes(minutes, emptyText = '-') {
  if (minutes === null || minutes === undefined) return emptyText;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

export const REPORT_TYPES = ['a01', 'a02', 'a03', 'a04', 'a05', 'a06'];

/**
 * 各集計の定義。
 * - rows(summary, emptyText): 表の行(値なしは emptyText。画面は '-'、CSVは '')
 * - chart(summary): グラフの種類とデータ
 */
export const REPORTS = {
  a01: {
    code: 'A-01',
    title: 'カテゴリ別件数',
    headers: ['カテゴリ', '件数'],
    rows: (s) => s.a01.map((r) => [r.category, r.count]),
    chart: (s) => ({ kind: 'bar', items: s.a01.map((r) => ({ label: r.category, value: r.count })) }),
  },
  a02: {
    code: 'A-02',
    title: '部署別件数',
    headers: ['部署', '件数'],
    rows: (s) => s.a02.map((r) => [r.dept, r.count]),
    chart: (s) => ({ kind: 'bar', items: s.a02.map((r) => ({ label: r.dept, value: r.count })) }),
  },
  a03: {
    code: 'A-03',
    title: 'カテゴリ別平均対応時間',
    headers: ['カテゴリ', '完了件数', '平均対応時間'],
    rows: (s, emptyText = '-') => s.a03.map((r) => [r.category, r.doneCount, formatMinutes(r.avgMinutes, emptyText)]),
    chart: (s) => ({
      kind: 'bar',
      items: s.a03.map((r) => ({ label: r.category, value: r.avgMinutes ?? 0, text: formatMinutes(r.avgMinutes) })),
    }),
  },
  a04: {
    code: 'A-04',
    title: '担当者別処理件数',
    headers: ['担当者', '完了件数', '未完了件数'],
    rows: (s) => s.a04.map((r) => [r.assignee, r.done, r.open]),
    chart: (s) => ({ kind: 'grouped', items: s.a04.map((r) => ({ label: r.assignee, done: r.done, open: r.open })) }),
  },
  a05: {
    code: 'A-05',
    title: '月別受付件数の推移',
    headers: ['月', '件数'],
    rows: (s) => s.a05.map((r) => [r.month.replace('-', '/'), r.count]),
    chart: (s) => ({ kind: 'line', items: s.a05.map((r) => ({ label: r.month.replace('-', '/'), value: r.count })) }),
  },
  a06: {
    code: 'A-06',
    title: 'ステータス別件数',
    headers: ['ステータス', '件数'],
    rows: (s) => s.a06.map((r) => [r.status, r.count]),
    chart: (s) => ({ kind: 'bar', items: s.a06.map((r) => ({ label: r.status, value: r.count })) }),
  },
};
