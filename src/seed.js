// サンプルデータ(docs/requirements.md F-11、6章「サンプルデータ」)。
//
// 日付は「実行日の前の週の月曜日」を基準にした相対日付で作る。
//   - 曜日の構造(土日またぎ・金曜の終業間際など)が、いつ実行しても保たれる。
//   - すべて過去の日時になる(前の週の日曜日が最後)。
//   - 直近約3〜4か月に分散する。
// 対応時間は、設計書の計算(src/domain/time.js)で求める。
import { transaction } from './db/transaction.js';
import { ensureInitialCategories } from './db/initial.js';
import { formatEpoch, workMinutes } from './domain/time.js';

const DAY = 24 * 60 * 60 * 1000;

// 氏名はすべて架空。担当者区分(isStaff)は 3名。
const EMPLOYEES = [
  { name: '山田 太郎', department: '情報システム', isStaff: true },
  { name: '佐藤 花子', department: '情報システム', isStaff: true },
  { name: '鈴木 一郎', department: '総務', isStaff: true },
  { name: '高橋 美咲', department: '人事', isStaff: false },
  { name: '吉田 愛', department: '人事', isStaff: false },
  { name: '田中 健太', department: '営業', isStaff: false },
  { name: '伊藤 さくら', department: '営業', isStaff: false },
  { name: '渡辺 大輔', department: '開発', isStaff: false },
  { name: '小林 優子', department: '開発', isStaff: false },
  { name: '加藤 誠', department: '総務', isStaff: false },
];

// 時刻の指定: [週, 曜日, 'HH:mm']。週は「前の週の月曜日」からの週数(0 = 前の週、-1 = その前の週…)、
// 曜日は 0=月 … 6=日。
// steps: ['assign', 時刻] / ['status', 変更後, 時刻, 対応内容?] / ['comment', 内容, 時刻]
export const SAMPLE_INQUIRIES = [
  { // 1: 営業時間内に完了(40分)
    title: 'パスワードを忘れた', body: 'ログインできない', requester: '田中 健太', category: 'アカウント・権限',
    priority: '中', assignee: '山田 太郎', registered: [-14, 0, '09:40'],
    steps: [['assign', [-14, 0, '09:45']], ['status', '対応中', [-14, 0, '09:50']],
      ['status', '完了', [-14, 0, '10:20'], 'パスワードを再発行した']],
  },
  { // 2: 同日に完了(325分)
    title: 'PCが起動しない', body: '電源を入れても画面が出ない', requester: '渡辺 大輔', category: 'PC・ネットワーク',
    priority: '高', assignee: '佐藤 花子', registered: [-13, 1, '10:05'],
    steps: [['assign', [-13, 1, '10:10']], ['status', '対応中', [-13, 1, '10:15']],
      ['comment', '電源ユニットを確認中', [-13, 1, '11:00']],
      ['status', '完了', [-13, 1, '15:30'], '電源ユニットを交換した']],
  },
  { // 3: 日をまたいで完了
    title: '新入社員のアカウント作成', body: '月曜入社の2名分', requester: '高橋 美咲', category: '入退社手続き',
    priority: '中', assignee: '鈴木 一郎', registered: [-11, 0, '13:00'],
    steps: [['assign', [-11, 0, '13:10']], ['status', '対応中', [-11, 0, '13:15']],
      ['status', '完了', [-11, 2, '11:00'], 'アカウントを作成し通知した']],
  },
  { // 4: 設計書の例(金曜 16:30 受付、月曜 9:00〜13:00 保留、火曜 10:00 完了 = 450分)
    title: 'ソフトのインストール申請', body: 'PDF編集ソフトを導入したい', requester: '伊藤 さくら', category: '備品・ソフト申請',
    priority: '低', assignee: '山田 太郎', registered: [-10, 4, '16:30'],
    steps: [['assign', [-10, 4, '16:35']], ['status', '対応中', [-10, 4, '17:00']],
      ['status', '保留', [-9, 0, '09:00']], ['comment', 'ライセンスの承認待ち', [-9, 0, '09:05']],
      ['status', '対応中', [-9, 0, '13:00']],
      ['status', '完了', [-9, 1, '10:00'], 'ライセンスを付与した']],
  },
  { // 5: 同日に完了(200分)
    title: 'Wi-Fiが繋がらない', body: '3階会議室で接続できない', requester: '加藤 誠', category: 'PC・ネットワーク',
    priority: '中', assignee: '佐藤 花子', registered: [-8, 2, '14:20'],
    steps: [['assign', [-8, 2, '14:25']], ['status', '対応中', [-8, 2, '14:30']],
      ['status', '完了', [-8, 2, '17:40'], 'アクセスポイントを再起動した']],
  },
  { // 6: 終業間際に受付、翌朝に完了(営業時間外をまたぐ。30分 + 30分 = 60分)
    title: '共有フォルダに入れない', body: '開発部の共有フォルダ', requester: '小林 優子', category: 'アカウント・権限',
    priority: '高', assignee: '山田 太郎', registered: [-7, 3, '17:30'],
    steps: [['assign', [-7, 3, '17:35']], ['status', '対応中', [-7, 3, '17:40']],
      ['status', '完了', [-7, 4, '09:30'], 'アクセス権を付与した']],
  },
  { // 7: 保留を挟む(火曜 10:00 〜 木曜 10:00 は対応時間から除く)
    title: 'モニターの追加申請', body: '2台目のモニターが欲しい', requester: '渡辺 大輔', category: '備品・ソフト申請',
    priority: '低', assignee: '鈴木 一郎', registered: [-6, 0, '15:30'],
    steps: [['assign', [-6, 0, '15:35']], ['status', '対応中', [-6, 0, '15:40']],
      ['status', '保留', [-6, 1, '10:00']], ['comment', '納期を確認中', [-6, 1, '10:10']],
      ['status', '対応中', [-6, 3, '10:00']],
      ['status', '完了', [-6, 3, '16:00'], '備品を手配し配布した']],
  },
  { // 8: 同日に完了(270分)
    title: '退職者のアカウント停止', body: '今週付けの退職者', requester: '吉田 愛', category: '入退社手続き',
    priority: '中', assignee: '鈴木 一郎', registered: [-5, 0, '10:00'],
    steps: [['assign', [-5, 0, '10:05']], ['status', '対応中', [-5, 0, '10:10']],
      ['status', '完了', [-5, 0, '14:30'], 'アカウントを停止した']],
  },
  { // 9: 金曜夕方に受付、月曜朝に完了(土日をまたぐ。70分 + 20分 = 90分)
    title: 'プリンターが印刷できない', body: '総務の複合機', requester: '加藤 誠', category: 'PC・ネットワーク',
    priority: '中', assignee: '佐藤 花子', registered: [-4, 4, '16:50'],
    steps: [['assign', [-4, 4, '16:55']], ['status', '対応中', [-4, 4, '17:00']],
      ['status', '完了', [-3, 0, '09:20'], 'ドライバーを再設定した']],
  },
  { // 10: 同日に完了(100分)
    title: 'メールが送信できない', body: '送信エラーになる', requester: '田中 健太', category: 'PC・ネットワーク',
    priority: '高', assignee: '山田 太郎', registered: [-3, 2, '09:30'],
    steps: [['assign', [-3, 2, '09:35']], ['status', '対応中', [-3, 2, '09:40']],
      ['status', '完了', [-3, 2, '11:10'], '容量を整理した']],
  },
  { // 11: 対応中
    title: 'VPNに接続できない', body: '在宅勤務で接続できない', requester: '小林 優子', category: 'PC・ネットワーク',
    priority: '高', assignee: '山田 太郎', registered: [-2, 3, '10:20'],
    steps: [['assign', [-2, 3, '10:25']], ['status', '対応中', [-2, 3, '10:30']],
      ['comment', '接続ログを確認中', [-2, 3, '14:00']]],
  },
  { // 12: 保留
    title: 'USBメモリの使用許可', body: '取引先とのデータ受け渡し', requester: '伊藤 さくら', category: 'その他',
    priority: '低', assignee: '鈴木 一郎', registered: [-1, 1, '14:00'],
    steps: [['assign', [-1, 1, '14:05']], ['status', '対応中', [-1, 1, '14:10']],
      ['status', '保留', [-1, 2, '09:00']], ['comment', '部門長の承認待ち', [-1, 2, '09:05']]],
  },
  { // 13: 対応中(関連する問い合わせあり)
    title: '権限の変更申請', body: '人事システムの閲覧権限', requester: '高橋 美咲', category: 'アカウント・権限',
    priority: '中', assignee: '佐藤 花子', registered: [-1, 2, '11:30'], relatedTitle: 'パスワードを忘れた',
    steps: [['assign', [-1, 2, '11:35']], ['status', '対応中', [-1, 2, '11:40']]],
  },
  { // 14: 未対応(担当者なし)
    title: 'キーボードの交換', body: 'キーが反応しない', requester: '加藤 誠', category: '備品・ソフト申請',
    priority: '低', registeredBy: '山田 太郎', registered: [-1, 3, '13:45'], steps: [],
  },
  { // 15: 未対応(担当者なし)
    title: 'ノートPCの貸出', body: '出張用に1台', requester: '田中 健太', category: '備品・ソフト申請',
    priority: '中', registeredBy: '佐藤 花子', registered: [-1, 4, '09:15'], steps: [],
  },
];

/** 実行日(now)を含む週の月曜日の、前の週の月曜日 0:00(壁時計の値を UTC とみなしたエポックミリ秒)。 */
export function anchorMonday(now) {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const weekdayIndex = (new Date(today).getUTCDay() + 6) % 7; // 月 = 0
  return today - weekdayIndex * DAY - 7 * DAY;
}

function resolveTime(anchor, [week, weekday, hhmm]) {
  const [h, m] = hhmm.split(':').map(Number);
  return formatEpoch(anchor + (week * 7 + weekday) * DAY + h * 60 * 60 * 1000 + m * 60 * 1000);
}

/**
 * 1件の問い合わせの履歴と最終状態を組み立てる(DBには書かない)。
 * 不整合(担当者の割当前にステータスを変えるなど)は、データの誤りとして例外にする。
 */
export function buildInquiry(item, anchor) {
  const at = (t) => resolveTime(anchor, t);
  const operator = item.assignee ?? item.registeredBy;
  const receivedAt = at(item.registered);
  const histories = [{ type: 'registered', content: '問い合わせを登録しました', operator: item.registeredBy ?? operator, at: receivedAt }];

  let status = '未対応';
  let assignee = null;
  let updatedAt = receivedAt;
  let completedAt = null;
  let resolution = null;

  const steps = item.steps
    .map((s) => ({ kind: s[0], at: at(s[s[0] === 'status' ? 2 : s[0] === 'comment' ? 2 : 1]), raw: s }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)); // 同時刻は定義の順を保つ(安定ソート)
  let last = receivedAt;
  for (const { kind, at: when, raw } of steps) {
    if (when < last) throw new Error(`時刻が逆転しています: ${item.title}`);
    last = when;
    if (kind === 'assign') {
      assignee = item.assignee;
      updatedAt = when;
      histories.push({ type: 'assignee', content: `担当者を「${item.assignee}」に設定`, operator, at: when });
    } else if (kind === 'status') {
      if (assignee === null) throw new Error(`担当者の割当前にステータスを変更しています: ${item.title}`);
      histories.push({ type: 'status', fromStatus: status, toStatus: raw[1], content: raw[3] ?? null, operator, at: when });
      status = raw[1];
      updatedAt = when;
      if (status === '完了') { completedAt = when; resolution = raw[3]; }
    } else if (kind === 'comment') {
      histories.push({ type: 'comment', content: raw[1], operator, at: when });
    } else {
      throw new Error(`不明な手順です: ${kind}`);
    }
  }
  if (status === '完了' && !resolution) throw new Error(`完了なのに対応内容がありません: ${item.title}`);

  const minutes = status === '完了'
    ? workMinutes({
      receivedAt, completedAt,
      histories: histories.filter((h) => h.type === 'status')
        .map((h) => ({ type: 'status', from_status: h.fromStatus, to_status: h.toStatus, at: h.at })),
    })
    : null;

  return { receivedAt, status, assignee, updatedAt, completedAt, resolution, workMinutes: minutes, histories };
}

/**
 * サンプルデータを投入する。社員または問い合わせが既にあるときは、何もしない。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ now?: Date }} [options] 基準日(テスト用)
 * @returns {{ seeded: boolean, employees: number, inquiries: number }}
 */
export function seedDatabase(db, { now = new Date() } = {}) {
  const count = (table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  if (count('employees') > 0 || count('inquiries') > 0) {
    return { seeded: false, employees: 0, inquiries: 0 };
  }

  const anchor = anchorMonday(now);
  // 登録順(受付日時の順)に ID が付くようにする
  const items = [...SAMPLE_INQUIRIES].sort((a, b) => {
    const ta = resolveTime(anchor, a.registered);
    const tb = resolveTime(anchor, b.registered);
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  transaction(db, () => {
    ensureInitialCategories(db);
    const insertEmployee = db.prepare('INSERT INTO employees (name, department, is_staff, is_active) VALUES (?, ?, ?, 1)');
    const employeeId = new Map();
    for (const e of EMPLOYEES) {
      employeeId.set(e.name, Number(insertEmployee.run(e.name, e.department, e.isStaff ? 1 : 0).lastInsertRowid));
    }

    const categoryRows = db.prepare('SELECT id, name FROM categories').all();
    const categoryId = (name) => {
      const found = categoryRows.find((c) => c.name === name);
      if (found) return found.id;
      // 初期値を変更済みのDBでも投入できるよう、足りないカテゴリは末尾に追加する
      const next = db.prepare('SELECT coalesce(max(sort_order), 0) + 1 AS n FROM categories').get().n;
      const id = Number(db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)').run(name, next).lastInsertRowid);
      categoryRows.push({ id, name });
      return id;
    };

    const insertInquiry = db.prepare(`INSERT INTO inquiries
      (title, body, requester_id, category_id, priority, status, assignee_id, related_inquiry_id, resolution,
       received_at, updated_at, completed_at, work_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertHistory = db.prepare(`INSERT INTO inquiry_histories
      (inquiry_id, type, from_status, to_status, content, operator_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)`);

    const inquiryId = new Map();
    for (const item of items) {
      const b = buildInquiry(item, anchor);
      const related = item.relatedTitle ? inquiryId.get(item.relatedTitle) ?? null : null;
      if (item.relatedTitle && related === null) throw new Error(`関連する問い合わせが先に登録されていません: ${item.title}`);
      const id = Number(insertInquiry.run(
        item.title, item.body, employeeId.get(item.requester), categoryId(item.category), item.priority, b.status,
        b.assignee === null ? null : employeeId.get(b.assignee), related, b.resolution,
        b.receivedAt, b.updatedAt, b.completedAt, b.workMinutes,
      ).lastInsertRowid);
      inquiryId.set(item.title, id);
      for (const h of b.histories) {
        insertHistory.run(id, h.type, h.fromStatus ?? null, h.toStatus ?? null, h.content ?? null, employeeId.get(h.operator), h.at);
      }
    }
  });

  return { seeded: true, employees: EMPLOYEES.length, inquiries: items.length };
}
