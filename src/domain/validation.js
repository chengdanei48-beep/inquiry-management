// 入力検証(docs/requirements.md 7章、docs/screen-design.md 2.3、docs/api-design.md 5章)。
// DBに依存しない検証だけを行う。存在確認(社員・カテゴリが有効か等)は API 側で行う。
import { validationError } from '../http/errors.js';
import { PRIORITIES, STATUSES } from './status.js';
import { isDateTimeString } from './time.js';

/** 自由入力の文字数上限(問い合わせ・コメント・氏名・部署・カテゴリ名など)。 */
export const MAX_TEXT_LENGTH = 50;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** 文字数(サロゲートペアを1文字と数える。SQLite の length() と同じ)。 */
export const textLength = (s) => [...s].length;

/** 'YYYY-MM-DD' が実在する日付か。 */
export function isDateString(value) {
  const m = typeof value === 'string' ? DATE_RE.exec(value) : null;
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/**
 * 項目ごとのエラーを集めて、最後に1つの VALIDATION_ERROR として投げる。
 * 各メソッドは、検証済みの値を返す(エラー時は undefined)。
 */
export class FieldValidator {
  constructor(input) {
    this.input = input;
    this.fields = [];
  }

  add(field, message) {
    this.fields.push({ field, message });
  }

  /** 文字列。前後の空白を除く。必須なら空は不可。50文字以内。 */
  text(key, label, { required = true } = {}) {
    const raw = this.input[key];
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      if (required) this.add(key, `${label}を入力してください`);
      return undefined;
    }
    if (typeof raw !== 'string') {
      this.add(key, `${label}は文字で入力してください`);
      return undefined;
    }
    const value = raw.trim();
    if (textLength(value) > MAX_TEXT_LENGTH) {
      this.add(key, `${label}は${MAX_TEXT_LENGTH}文字以内で入力してください`);
      return undefined;
    }
    return value;
  }

  /** 選択肢。 */
  choice(key, label, allowed, { required = true } = {}) {
    const raw = this.input[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.add(key, `${label}を選択してください`);
      return undefined;
    }
    if (!allowed.includes(raw)) {
      this.add(key, `${label}を選択してください`);
      return undefined;
    }
    return raw;
  }

  /** ID(正の整数。数字だけの文字列も受け付ける)。 */
  id(key, label, { required = true } = {}) {
    const raw = this.input[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.add(key, `${label}を選択してください`);
      return undefined;
    }
    const n = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
    if (!Number.isSafeInteger(n) || n < 1) {
      this.add(key, `${label}を選択してください`);
      return undefined;
    }
    return n;
  }

  /** 整数(0以上)。表示順などに使う。 */
  integer(key, label, { required = true } = {}) {
    const raw = this.input[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.add(key, `${label}を入力してください`);
      return undefined;
    }
    const n = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
    if (!Number.isSafeInteger(n) || n < 0) {
      this.add(key, `${label}は0以上の整数で入力してください`);
      return undefined;
    }
    return n;
  }

  /** 真偽値(true / false のみ)。 */
  flag(key, label, { required = true } = {}) {
    const raw = this.input[key];
    if (raw === undefined || raw === null) {
      if (required) this.add(key, `${label}を選択してください`);
      return undefined;
    }
    if (typeof raw !== 'boolean') {
      this.add(key, `${label}を選択してください`);
      return undefined;
    }
    return raw;
  }

  /** 取得時の更新日時(同時更新の検出に使う)。 */
  updatedAt(key = 'updatedAt') {
    const raw = this.input[key];
    if (!isDateTimeString(raw)) {
      this.add(key, '更新日時が正しくありません。画面を再読み込みしてください');
      return undefined;
    }
    return raw;
  }

  throwIfInvalid() {
    if (this.fields.length > 0) throw validationError(this.fields);
  }
}

const CATEGORY_LABEL = 'カテゴリ';

/**
 * GET /api/inquiries のクエリ(一覧・CSV で共通)。
 * @param {URLSearchParams|object} params
 */
export function parseInquiryListQuery(params) {
  const q = params instanceof URLSearchParams ? Object.fromEntries(params) : { ...params };
  const v = new FieldValidator(q);
  const value = {
    status: v.choice('status', 'ステータス', STATUSES, { required: false }),
    categoryId: v.id('categoryId', CATEGORY_LABEL, { required: false }),
    // 'none' は「未割当」
    assigneeId: q.assigneeId === 'none' ? 'none' : v.id('assigneeId', '担当者', { required: false }),
    dept: v.text('dept', '部署', { required: false }),
    q: v.text('q', 'キーワード', { required: false }),
    sort: v.choice('sort', '並び替え', ['received', 'priority'], { required: false }) ?? 'received',
    dir: v.choice('dir', '並び順', ['asc', 'desc'], { required: false }) ?? 'desc',
    page: v.id('page', 'ページ', { required: false }) ?? 1,
  };
  v.throwIfInvalid();
  return value;
}

/** POST /api/inquiries */
export function parseInquiryCreate(body) {
  const v = new FieldValidator(body);
  const value = {
    title: v.text('title', '件名'),
    body: v.text('body', '内容'),
    requesterId: v.id('requesterId', '依頼者'),
    categoryId: v.id('categoryId', CATEGORY_LABEL),
    priority: v.choice('priority', '優先度', PRIORITIES),
    relatedInquiryId: v.id('relatedInquiryId', '関連する問い合わせ', { required: false }) ?? null,
  };
  v.throwIfInvalid();
  return value;
}

/** PATCH /api/inquiries/{id}(指定した項目だけ更新) */
export function parseInquiryPatch(body) {
  const v = new FieldValidator(body);
  const value = {};
  if (has(body, 'title')) value.title = v.text('title', '件名');
  if (has(body, 'body')) value.body = v.text('body', '内容');
  if (has(body, 'categoryId')) value.categoryId = v.id('categoryId', CATEGORY_LABEL);
  if (has(body, 'priority')) value.priority = v.choice('priority', '優先度', PRIORITIES);
  value.updatedAt = v.updatedAt();
  if (Object.keys(value).length === 1 && v.fields.length === 0) {
    v.add('title', '変更する項目を指定してください');
  }
  v.throwIfInvalid();
  return value;
}

/** POST /api/inquiries/{id}/status */
export function parseStatusChange(body) {
  const v = new FieldValidator(body);
  const status = v.choice('status', 'ステータス', STATUSES);
  const resolution = status === '完了'
    ? v.text('resolution', '対応内容')
    : undefined;
  const updatedAt = v.updatedAt();
  v.throwIfInvalid();
  return { status, resolution: resolution ?? null, updatedAt };
}

/** POST /api/inquiries/{id}/assignee */
export function parseAssigneeChange(body) {
  const v = new FieldValidator(body);
  const assigneeId = v.id('assigneeId', '担当者');
  const updatedAt = v.updatedAt();
  v.throwIfInvalid();
  return { assigneeId, updatedAt };
}

/** POST /api/inquiries/{id}/comments */
export function parseComment(body) {
  const v = new FieldValidator(body);
  const text = v.text('text', 'コメント');
  v.throwIfInvalid();
  return { text };
}

/** POST /api/employees(partial=false)、PATCH /api/employees/{id}(partial=true) */
export function parseEmployee(body, { partial = false } = {}) {
  const v = new FieldValidator(body);
  const value = {};
  const want = (key) => !partial || has(body, key);
  if (want('name')) value.name = v.text('name', '氏名');
  if (want('department')) value.department = v.text('department', '部署');
  // 追加時は省略できる(既定は「一般」)。編集時は、指定したなら値が必須(null で意図せず「一般」にしない)
  if (want('isStaff')) value.isStaff = v.flag('isStaff', '担当者区分', { required: partial });
  if (partial && has(body, 'isActive')) value.isActive = v.flag('isActive', '状態');
  if (partial && Object.keys(value).length === 0) v.add('name', '変更する項目を指定してください');
  v.throwIfInvalid();
  if (!partial && value.isStaff === undefined) value.isStaff = false;
  return value;
}

/** POST /api/categories(partial=false)、PATCH /api/categories/{id}(partial=true) */
export function parseCategory(body, { partial = false } = {}) {
  const v = new FieldValidator(body);
  const value = {};
  const want = (key) => !partial || has(body, key);
  if (want('name')) value.name = v.text('name', '名称');
  if (want('sortOrder')) value.sortOrder = v.integer('sortOrder', '表示順');
  if (partial && has(body, 'isActive')) value.isActive = v.flag('isActive', '状態');
  if (partial && Object.keys(value).length === 0) v.add('name', '変更する項目を指定してください');
  v.throwIfInvalid();
  return value;
}

/**
 * GET /api/employees・/api/categories の絞り込み(staff / active は '1' か '0')。
 * 指定が無ければ undefined(絞り込まない)。
 */
export function parseMasterListQuery(params, keys) {
  const q = params instanceof URLSearchParams ? Object.fromEntries(params) : { ...params };
  const v = new FieldValidator(q);
  const value = {};
  for (const key of keys) {
    const raw = q[key];
    if (raw === undefined || raw === '') continue;
    if (raw !== '1' && raw !== '0') {
      v.add(key, `${key} は 1 か 0 で指定してください`);
      continue;
    }
    value[key] = raw === '1';
  }
  v.throwIfInvalid();
  return value;
}

/** 集計の期間(from, to: 'YYYY-MM-DD')。from が to より後なら不正。 */
export function parseDateRange(query) {
  const v = new FieldValidator(query);
  const check = (key, label) => {
    const raw = query[key];
    if (raw === undefined || raw === '') {
      v.add(key, `${label}を入力してください`);
      return undefined;
    }
    if (!isDateString(raw)) {
      v.add(key, `${label}を正しく入力してください`);
      return undefined;
    }
    return raw;
  };
  const from = check('from', '開始日');
  const to = check('to', '終了日');
  if (from && to && from > to) v.add('from', '開始日は終了日以前の日付にしてください');
  v.throwIfInvalid();
  return { from, to };
}

/** 月次保存の対象月('YYYY-MM')。 */
export function parseMonth(value, key = 'month') {
  if (typeof value !== 'string' || !MONTH_RE.test(value)) {
    throw validationError([{ field: key, message: '対象月を正しく選択してください' }]);
  }
  return value;
}
