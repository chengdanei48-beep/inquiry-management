// 集計・CSV・月次保存のAPI(docs/api-design.md 4章・5.9〜5.11)。
import fs from 'node:fs';
import path from 'node:path';
import { notFound, validationError } from '../http/errors.js';
import { sendCsv, sendFileBuffer } from '../http/respond.js';
import { toCsv } from '../domain/csv.js';
import { parseDateRange, parseMonth } from '../domain/validation.js';
import { buildSummary } from '../repo/reports.js';
import { REPORT_TYPES, REPORTS } from '../../public/js/report-tables.js';
import { renderReportChart } from '../../public/js/charts.js';
import { requireOperator } from './operator.js';

const MONTH_DIR_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
// ダウンロードできるのは、集計の種類ごとの固定のファイル名だけ(a01.csv, a01.svg, …)
const FILE_RE = /^a0[1-6]\.(csv|svg)$/;
const META_FILE = 'meta.json';
const CONTENT_TYPES = { csv: 'text/csv; charset=utf-8', svg: 'image/svg+xml; charset=utf-8' };

/** 'YYYY-MM' の1日と末日('YYYY-MM-DD')。 */
function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

function readMeta(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, META_FILE), 'utf8'));
  } catch {
    return null;
  }
}

/** 集計表(summary と種類)から CSV 本文を作る(値なしは空欄)。 */
export function reportCsv(type, summary) {
  const def = REPORTS[type];
  return toCsv(def.headers, def.rows(summary, ''));
}

export const reportRoutes = [
  {
    method: 'GET',
    path: '/api/reports/summary',
    handler: async ({ db, url }) => {
      const { from, to } = parseDateRange(Object.fromEntries(url.searchParams));
      return { body: buildSummary(db, from, to) };
    },
  },

  {
    method: 'GET',
    path: '/api/reports/export.csv',
    handler: async ({ db, res, url }) => {
      const query = Object.fromEntries(url.searchParams);
      const type = query.type;
      if (!REPORT_TYPES.includes(type)) {
        throw validationError([{ field: 'type', message: '集計の種類を選択してください' }]);
      }
      const { from, to } = parseDateRange(query);
      const summary = buildSummary(db, from, to);
      sendCsv(res, `report-${type}-${from}_${to}.csv`, reportCsv(type, summary));
    },
  },

  {
    method: 'POST',
    path: '/api/reports/monthly',
    handler: async ({ db, req, readJson, config, now }) => {
      requireOperator(db, req);
      const body = await readJson();
      const month = parseMonth(body.month);
      const { from, to } = monthRange(month);
      const summary = buildSummary(db, from, to);
      const savedAt = now();

      // 一時ディレクトリに全ファイルを書いてから入れ替える(途中で失敗しても、前回の保存を壊さない)
      const root = config.reportsDir;
      const target = path.join(root, month);
      const temp = path.join(root, `.${month}.tmp-${process.pid}`);
      fs.rmSync(temp, { recursive: true, force: true });
      fs.mkdirSync(temp, { recursive: true });
      const files = [];
      try {
        for (const type of REPORT_TYPES) {
          fs.writeFileSync(path.join(temp, `${type}.csv`), reportCsv(type, summary), 'utf8');
          const svg = renderReportChart(type, summary, {
            title: `${REPORTS[type].code} ${REPORTS[type].title}(${month.replace('-', '/')})`,
            standalone: true,
          });
          fs.writeFileSync(path.join(temp, `${type}.svg`), svg, 'utf8');
          files.push(`${type}.csv`, `${type}.svg`);
        }
        fs.writeFileSync(path.join(temp, META_FILE), JSON.stringify({ month, savedAt, files }), 'utf8');
        const overwritten = fs.existsSync(target);
        fs.rmSync(target, { recursive: true, force: true });
        fs.renameSync(temp, target);
        return { status: 201, body: { month, savedAt, files, overwritten } };
      } catch (err) {
        fs.rmSync(temp, { recursive: true, force: true });
        throw err;
      }
    },
  },

  {
    method: 'GET',
    path: '/api/reports/monthly',
    handler: async ({ config }) => {
      let names = [];
      try {
        names = fs.readdirSync(config.reportsDir);
      } catch {
        names = []; // まだ1度も保存していない
      }
      const items = names
        .filter((n) => MONTH_DIR_RE.test(n))
        .map((n) => readMeta(path.join(config.reportsDir, n)))
        .filter(Boolean)
        .map((m) => ({ month: m.month, savedAt: m.savedAt, files: m.files }))
        .sort((a, b) => (a.month < b.month ? -1 : 1));
      return { body: { items } };
    },
  },

  {
    method: 'GET',
    path: '/api/reports/monthly/:month/:file',
    handler: async ({ res, params, config }) => {
      // 月とファイル名は、固定の形のものだけを受け付ける(パス・トラバーサル対策)
      if (!MONTH_DIR_RE.test(params.month) || !FILE_RE.test(params.file)) throw notFound('ファイルが見つかりません');
      const file = path.join(config.reportsDir, params.month, params.file);
      let buffer;
      try {
        buffer = fs.readFileSync(file);
      } catch {
        throw notFound('ファイルが見つかりません');
      }
      const ext = params.file.slice(params.file.lastIndexOf('.') + 1);
      sendFileBuffer(res, CONTENT_TYPES[ext], `${params.month}-${params.file}`, buffer);
    },
  },
];
