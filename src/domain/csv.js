// CSV出力(docs/requirements.md 7章、docs/api-design.md 5.10)。
// UTF-8(BOM付き)・改行は CRLF。Excelで開けるようにする。

const BOM = '﻿';

// 表計算ソフトで「式」として実行されうる先頭文字(CSVインジェクション対策)
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** 1つのセルをCSVの文字列にする。 */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (FORMULA_PREFIX.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {string[]} headers
 * @param {Array<Array<string|number|null>>} rows
 * @returns {string} BOM付きのCSV(各行の末尾は CRLF)
 */
export function toCsv(headers, rows) {
  const lines = [headers, ...rows].map((cols) => cols.map(csvCell).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
