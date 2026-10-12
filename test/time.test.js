import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  businessMinutes, formatDateTime, formatMinutes, holdIntervals, isDateTimeString,
  parseDateTime, workMinutes,
} from '../src/domain/time.js';

const dt = (s) => parseDateTime(s);
const at = (date, time) => `${date} ${time}.000`;

// 履歴(ステータス変更)を作る
const status = (when, from, to) => ({ type: 'status', from_status: from, to_status: to, at: when });

test('日時: 曜日の前提(設計書の例の日付)', () => {
  const day = (s) => new Date(dt(`${s} 00:00:00.000`)).getUTCDay();
  assert.equal(day('2026-10-09'), 5); // 金
  assert.equal(day('2026-10-12'), 1); // 月
  assert.equal(day('2026-10-13'), 2); // 火
  assert.equal(day('2027-01-04'), 1); // 月
  assert.equal(day('2028-02-29'), 2); // 火(うるう日)
});

test('日時: 形式の確認と変換', () => {
  assert.equal(isDateTimeString('2026-10-12 09:30:00.000'), true);
  for (const bad of ['2026/10/12 09:30', '2026-10-12T09:30:00.000', '2026-02-30 09:00:00.000', '2026-10-12 24:00:00.000', '2026-13-01 00:00:00.000', '', null, 20261012]) {
    assert.equal(isDateTimeString(bad), false, String(bad));
  }
  assert.throws(() => parseDateTime('2026-02-30 09:00:00.000'), RangeError);
});

test('日時: 生成した文字列は解析できる(実行環境のタイムゾーンに依存しない)', () => {
  const s = formatDateTime(new Date(2026, 9, 12, 9, 5, 7, 42));
  assert.equal(s, '2026-10-12 09:05:07.042');
  assert.equal(isDateTimeString(s), true);
  assert.match(formatDateTime(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
});

test('対応時間: 設計書の例(金曜 16:30 受付、月曜 9:00〜13:00 保留、火曜 10:00 完了)は 450分(7:30)', () => {
  const minutes = workMinutes({
    receivedAt: at('2026-10-09', '16:30:00'),
    completedAt: at('2026-10-13', '10:00:00'),
    histories: [
      status(at('2026-10-09', '17:00:00'), '未対応', '対応中'),
      status(at('2026-10-12', '09:00:00'), '対応中', '保留'),
      status(at('2026-10-12', '13:00:00'), '保留', '対応中'),
    ],
  });
  // 金 1:30 + 月 (9:00 - 保留4:00 = 5:00) + 火 1:00 = 7:30
  assert.equal(minutes, 450);
  assert.equal(formatMinutes(minutes), '7:30');
});

test('対応時間: 同じ日の営業時間内', () => {
  assert.equal(businessMinutes(dt(at('2026-10-12', '09:00:00')), dt(at('2026-10-12', '18:00:00'))), 540);
  assert.equal(businessMinutes(dt(at('2026-10-12', '10:15:00')), dt(at('2026-10-12', '11:45:00'))), 90);
});

test('対応時間: 営業時間外(始業前・終業後)は数えない', () => {
  // 始業前 08:00 → 10:00 は 9:00〜10:00 の60分
  assert.equal(businessMinutes(dt(at('2026-10-12', '08:00:00')), dt(at('2026-10-12', '10:00:00'))), 60);
  // 終業後 19:00 → 翌営業日 09:30 は30分
  assert.equal(businessMinutes(dt(at('2026-10-12', '19:00:00')), dt(at('2026-10-13', '09:30:00'))), 30);
  // 営業時間外だけ(夜間)は 0
  assert.equal(businessMinutes(dt(at('2026-10-12', '18:00:00')), dt(at('2026-10-13', '09:00:00'))), 0);
});

test('対応時間: 土日は数えない', () => {
  // 金 17:00 → 月 10:00 = 金 60 + 月 60
  assert.equal(businessMinutes(dt(at('2026-10-09', '17:00:00')), dt(at('2026-10-12', '10:00:00'))), 120);
  // 土曜に受付 → 月曜 9:00 に完了は 0
  assert.equal(businessMinutes(dt(at('2026-10-10', '10:00:00')), dt(at('2026-10-12', '09:00:00'))), 0);
});

test('対応時間: 2週間(平日10日分)は 5400分', () => {
  assert.equal(businessMinutes(dt(at('2026-10-12', '09:00:00')), dt(at('2026-10-26', '09:00:00'))), 10 * 540);
});

test('対応時間: 年またぎ・うるう日', () => {
  // 2026-12-31(木) 17:00 → 2027-01-04(月) 10:00 = 木 60 + 金 540 + 月 60
  assert.equal(businessMinutes(dt(at('2026-12-31', '17:00:00')), dt(at('2027-01-04', '10:00:00'))), 660);
  // 2028-02-28(月) 17:00 → 2028-03-01(水) 10:00 = 月 60 + 火(うるう日) 540 + 水 60
  assert.equal(businessMinutes(dt(at('2028-02-28', '17:00:00')), dt(at('2028-03-01', '10:00:00'))), 660);
});

test('対応時間: 分未満は切り捨て、開始と終了が同じなら 0', () => {
  assert.equal(businessMinutes(dt('2026-10-12 09:00:00.000'), dt('2026-10-12 09:00:59.999')), 0);
  assert.equal(businessMinutes(dt('2026-10-12 09:00:00.000'), dt('2026-10-12 09:01:00.000')), 1);
  assert.equal(businessMinutes(dt(at('2026-10-12', '10:00:00')), dt(at('2026-10-12', '10:00:00'))), 0);
});

test('対応時間: 終了が開始より前なら RangeError', () => {
  assert.throws(() => businessMinutes(dt(at('2026-10-12', '10:00:00')), dt(at('2026-10-12', '09:00:00'))), RangeError);
});

test('保留: 複数回の保留をすべて除く', () => {
  const minutes = workMinutes({
    receivedAt: at('2026-10-12', '09:00:00'),
    completedAt: at('2026-10-12', '17:00:00'),
    histories: [
      status(at('2026-10-12', '10:00:00'), '対応中', '保留'),
      status(at('2026-10-12', '11:00:00'), '保留', '対応中'),
      status(at('2026-10-12', '14:00:00'), '対応中', '保留'),
      status(at('2026-10-12', '15:30:00'), '保留', '対応中'),
    ],
  });
  // 9:00〜17:00 = 480 から 保留 60 + 90 を除く
  assert.equal(minutes, 480 - 60 - 90);
});

test('保留: 土日をまたぐ保留と、営業時間外だけの保留', () => {
  const minutes = workMinutes({
    receivedAt: at('2026-10-09', '16:00:00'),
    completedAt: at('2026-10-12', '12:00:00'),
    histories: [
      status(at('2026-10-09', '17:00:00'), '対応中', '保留'),
      status(at('2026-10-12', '10:00:00'), '保留', '対応中'),
    ],
  });
  // 金 16:00〜17:00 = 60、月 10:00〜12:00 = 120(保留中の金 17:00〜18:00 と 月 9:00〜10:00 は除く)
  assert.equal(minutes, 180);
  // 営業時間外だけの保留は、対応時間に影響しない
  const same = workMinutes({
    receivedAt: at('2026-10-12', '16:00:00'),
    completedAt: at('2026-10-13', '10:00:00'),
    histories: [
      status(at('2026-10-12', '19:00:00'), '対応中', '保留'),
      status(at('2026-10-13', '08:00:00'), '保留', '対応中'),
    ],
  });
  assert.equal(same, 120 + 60);
});

test('保留: 完了時点で保留が続いていた場合は完了日時までを除く', () => {
  const histories = [status(at('2026-10-12', '10:00:00'), '対応中', '保留')];
  const intervals = holdIntervals(histories, at('2026-10-12', '12:00:00'));
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0][1] - intervals[0][0], 2 * 60 * 60 * 1000);
});

test('保留: ステータス以外の履歴・順序の乱れ・履歴なし', () => {
  const histories = [
    status(at('2026-10-12', '13:00:00'), '保留', '対応中'), // 並びが逆でも、日時順に扱う
    { type: 'comment', content: '連絡待ち', at: at('2026-10-12', '10:30:00') },
    status(at('2026-10-12', '10:00:00'), '対応中', '保留'),
  ];
  assert.equal(holdIntervals(histories, at('2026-10-12', '17:00:00')).length, 1);
  assert.deepEqual(holdIntervals([], at('2026-10-12', '17:00:00')), []);
  assert.equal(
    workMinutes({ receivedAt: at('2026-10-12', '09:00:00'), completedAt: at('2026-10-12', '12:00:00') }),
    180,
  );
});

test('書式: 分を H:mm にする(未計測は -)', () => {
  assert.equal(formatMinutes(0), '0:00');
  assert.equal(formatMinutes(40), '0:40');
  assert.equal(formatMinutes(325), '5:25');
  assert.equal(formatMinutes(1030), '17:10');
  assert.equal(formatMinutes(null), '-');
});
