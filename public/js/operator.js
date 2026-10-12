// 「操作する担当者」(docs/requirements.md 3章)。ブラウザに保存し、次回も既定値にする。
// 保存できない環境(プライベートウィンドウなど)でも動作する(毎回選択する)。

const KEY = 'inquiry-management.operatorId';

export function createOperatorStore(storage = safeLocalStorage()) {
  let memory = null; // 保存できない環境では、メモリにだけ持つ
  return {
    get() {
      try {
        const v = storage ? storage.getItem(KEY) : null;
        if (v !== null) return /^[1-9]\d*$/.test(v) ? Number(v) : null;
      } catch { /* 読めない環境 */ }
      return memory;
    },
    set(id) {
      memory = id ?? null;
      try {
        if (!storage) return;
        if (id === null || id === undefined) storage.removeItem(KEY);
        else storage.setItem(KEY, String(id));
      } catch { /* 書けない環境 */ }
    },
  };
}

function safeLocalStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
