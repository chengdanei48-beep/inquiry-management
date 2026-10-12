// APIクライアント(docs/api-design.md)。通信の失敗とサーバーのエラーを ApiError にそろえる。
// fetch と操作者の取得は差し替えできる(テスト用)。

export const NETWORK_ERROR_MESSAGE = '通信に失敗しました。時間をおいて、もう一度お試しください';
export const SERVER_ERROR_MESSAGE = '処理に失敗しました。時間をおいて、もう一度お試しください';

export class ApiError extends Error {
  /**
   * @param {{status: number, code: string, message: string, fields?: Array<{field: string, message: string}>}} e
   */
  constructor({ status, code, message, fields }) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // 通信失敗は 0
    this.code = code; // 通信失敗は 'NETWORK'
    this.fields = fields ?? [];
  }

  get isNetwork() { return this.code === 'NETWORK'; }
  get isConflict() { return this.status === 409; }
  get isNotFound() { return this.status === 404; }
  get isValidation() { return this.status === 400 && this.fields.length > 0; }
}

/** オブジェクトからクエリ文字列を作る(空・null・undefined は除く)。先頭の `?` を含む。 */
export function buildQuery(query = {}) {
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export function createApi({ fetchFn = (...args) => fetch(...args), getOperatorId = () => null } = {}) {
  async function request(method, path, { query, body } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // 変更系は、操作する担当者を送る(サーバー側で必ず確認される)
    if (method !== 'GET') {
      const operatorId = getOperatorId();
      if (operatorId) headers['X-Operator-Id'] = String(operatorId);
    }

    let res;
    try {
      res = await fetchFn(`${path}${buildQuery(query)}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError({ status: 0, code: 'NETWORK', message: NETWORK_ERROR_MESSAGE });
    }

    let data = null;
    try {
      const text = await res.text();
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const error = data && data.error ? data.error : {};
      throw new ApiError({
        status: res.status,
        code: error.code ?? 'UNKNOWN',
        message: error.message ?? SERVER_ERROR_MESSAGE,
        fields: error.fields,
      });
    }
    return data;
  }

  return {
    request,
    listInquiries: (query) => request('GET', '/api/inquiries', { query }),
    getInquiry: (id) => request('GET', `/api/inquiries/${id}`),
    createInquiry: (body) => request('POST', '/api/inquiries', { body }),
    updateInquiry: (id, body) => request('PATCH', `/api/inquiries/${id}`, { body }),
    changeStatus: (id, body) => request('POST', `/api/inquiries/${id}/status`, { body }),
    changeAssignee: (id, body) => request('POST', `/api/inquiries/${id}/assignee`, { body }),
    addComment: (id, body) => request('POST', `/api/inquiries/${id}/comments`, { body }),
    listEmployees: (query) => request('GET', '/api/employees', { query }),
    listCategories: (query) => request('GET', '/api/categories', { query }),
    inquiriesCsvUrl: (query) => `/api/inquiries/export.csv${buildQuery(query)}`,
  };
}
