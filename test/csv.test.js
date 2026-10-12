import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv } from '../src/domain/csv.js';

test('CSV: BOM付き・CRLF・末尾も改行', () => {
  const csv = toCsv(['ID', '件名'], [[1, 'VPN'], [2, 'PC']]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv, '﻿ID,件名\r\n1,VPN\r\n2,PC\r\n');
});

test('CSV: カンマ・引用符・改行を含むセルは引用符で囲み、引用符は二重にする', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvCell('1行目\n2行目'), '"1行目\n2行目"');
  assert.equal(csvCell('1行目\r\n2行目'), '"1行目\r\n2行目"');
  assert.equal(csvCell('普通'), '普通');
});

test('CSV: 式として実行されうる先頭文字(= + - @ タブ CR)は無害化する', () => {
  assert.equal(csvCell('=SUM(A1:A2)'), "'=SUM(A1:A2)");
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell('\t=1'), "'\t=1");
  // 先頭以外にあるものは変えない
  assert.equal(csvCell('a=b'), 'a=b');
  assert.equal(csvCell('2026-10-12'), '2026-10-12');
});

test('CSV: 無害化と引用符が重なる場合も正しい', () => {
  assert.equal(csvCell('=A1,B1'), `"'=A1,B1"`);
  assert.equal(csvCell('@"x"'), `"'@""x"""`);
});

test('CSV: null・undefined は空欄、数値はそのまま', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(12.5), '12.5');
});

test('CSV: 行が0件でもヘッダーは出力される', () => {
  assert.equal(toCsv(['A', 'B'], []), '﻿A,B\r\n');
});
