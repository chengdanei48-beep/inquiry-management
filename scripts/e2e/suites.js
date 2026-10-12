// 実ブラウザでの確認項目(画面設計書・要件定義書 8章に対応)。
// 各スイートは、新しいDB・新しいブラウザ(保存データなし)で実行される。
//   inquiries … サンプルデータ投入済み。S-01〜S-03、キーボード操作、XSS、通信失敗
//   reports   … サンプルデータ投入済み。S-04、S-05
//   bootstrap … 空のDB。初期セットアップ
// 日付に依存しない書き方にしている(サンプルデータは実行日を基準にした相対日付)。

const J = JSON.stringify;

/** 'YYYY-MM' から 'YYYY-MM' までの月の一覧(両端を含む)。 */
function monthsBetween(fromMonth, toMonth) {
  const out = [];
  let [y, m] = fromMonth.split('-').map(Number);
  const [ey, em] = toMonth.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// ---------- S-01〜S-03 ----------
export async function inquiriesSuite({ d, check, baseUrl }) {
  const { page } = d;
  await page.goto(`${baseUrl}/`);
  await d.waitHeading('問い合わせ一覧');

  // S-01 一覧
  check('一覧: サンプル15件が表示される', (await d.count('#view tbody tr')) === 15);
  check('一覧: メニューの現在の画面が強調される', (await d.text('#menu a[aria-current="page"]')) === '一覧');
  check('一覧: 操作する担当者の選択肢は担当者3名 + 未選択', (await d.count('#operator option')) === 4);
  check('一覧: CSV出力のリンクが、現在の条件で作られる',
    ((await d.attr('a[download]', 'href')) ?? '').endsWith('/api/inquiries/export.csv?sort=received&dir=desc'));
  check('一覧: 新しい順に並ぶ(先頭が最新)',
    (await page.eval(`document.querySelector('#view tbody tr td:nth-child(2)').textContent`)) === 'ノートPCの貸出');
  await d.shot('01-list');

  await d.setValue('#f-status', '完了');
  await d.clickButton('検索');
  await page.waitFor(`location.hash.includes('status=')`);
  await page.waitFor(`document.querySelectorAll('#view tbody tr').length === 10`, { label: '完了の10件' });
  check('一覧: ステータスで絞り込むと、条件がURLに入り10件になる', (await d.count('#view tbody tr')) === 10);

  await page.eval(`[...document.querySelectorAll('th button')].find((b) => b.textContent.startsWith('優先度')).click()`);
  await page.waitFor(`location.hash.includes('sort=priority')`);
  await page.waitFor(`document.querySelector('#view tbody tr td:nth-child(5)')?.textContent === '高'`, { label: '優先度の高い順' });
  check('一覧: 優先度で並び替えると高い順になる(条件も保持される)', (await page.eval('location.hash')).includes('status='));

  await d.clickButton('条件をクリア');
  await page.waitFor(`document.querySelectorAll('#view tbody tr').length === 15`, { label: 'クリア後の15件' });
  check('一覧: 条件をクリアすると全件に戻る', (await d.count('#view tbody tr')) === 15);

  await d.goto('#/inquiries?page=5');
  await page.waitFor(`document.querySelector('#view')?.textContent.includes('このページには表示するデータがありません')`);
  check('一覧: 範囲外のページでは、案内と「1ページ目へ」が出る', await d.buttonExists('1ページ目へ'));

  await d.goto(`#/inquiries?q=${encodeURIComponent('存在しない語')}`);
  await page.waitFor(`document.querySelector('#view')?.textContent.includes('該当するデータはありません')`);
  check('一覧: 0件のとき「該当するデータはありません」を表示する', true);
  await d.goto('#/inquiries');
  await d.waitHeading('問い合わせ一覧');

  // S-02 登録
  await d.goto('#/inquiries/new');
  await d.waitHeading('問い合わせ登録');
  const registerDisabled = `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '登録').disabled`;
  check('登録: 操作する担当者が未選択のとき、案内が出て登録ボタンが無効',
    (await d.messageText()).includes('操作する担当者を選択してください') && (await page.eval(registerDisabled)) === true);
  const yamada = await d.optionValue('#operator', '山田 太郎');
  await d.setValue('#operator', yamada);
  check('登録: 担当者を選ぶと、案内が消えて登録ボタンが有効になる',
    (await d.messageText()).trim() === '' && (await page.eval(registerDisabled)) === false);

  await d.clickButton('登録');
  check('登録: 未入力では、項目ごとのエラーが出て、最初の項目にフォーカスが移る',
    (await d.text('#n-title-error')) === '件名を入力してください'
    && (await d.text('#n-body-error')) === '内容を入力してください'
    && (await d.text('#n-requester-error')) === '依頼者を選択してください'
    && (await d.text('#n-category-error')) === 'カテゴリを選択してください'
    && (await d.attr('#n-title', 'aria-invalid')) === 'true'
    && (await page.eval('document.activeElement.id')) === 'n-title');
  await d.shot('02-new-errors');

  await d.setValue('#n-title', 'あ'.repeat(51));
  check('登録: 文字数カウンタが「51/50」になる', (await d.text('#n-title-count')) === '51/50');
  await d.clickButton('登録');
  check('登録: 51文字は「50文字以内」のエラー(画面で拒否される)', (await d.text('#n-title-error')) === '件名は50文字以内で入力してください');
  await d.setValue('#n-title', 'あ'.repeat(50));
  check('登録: 50文字は画面の検証を通る(境界値)', true);
  await d.setValue('#n-related', '9999');
  await d.setValue('#n-title', 'E2E: 画面から登録');
  await d.setValue('#n-body', '動作確認のための問い合わせ');
  await d.setValue('#n-requester', await d.optionValue('#n-requester', '田中 健太'));
  await d.setValue('#n-category', await d.optionValue('#n-category', 'PC・ネットワーク'));
  await d.clickButton('登録');
  await page.waitFor(`document.querySelector('#n-related-error')?.textContent.includes('指定した問い合わせが見つかりません')`, { label: 'サーバーの項目エラー' });
  check('登録: サーバーの項目エラー(存在しない関連ID)が、該当項目の下に出る', true);
  await d.setValue('#n-related', '');
  await d.clickButton('登録');
  await page.waitFor(`/^#\\/inquiries\\/\\d+$/.test(location.hash)`);
  await d.waitHeading('E2E: 画面から登録');
  check('登録: 登録すると詳細画面に移動し、完了メッセージが出る', (await d.messageText()).includes('問い合わせを登録しました'));
  const newId = Number((await page.eval('location.hash')).split('/').pop());
  check('登録: ステータスは「未対応」', (await d.text('#view h2 .badge')) === '未対応');

  // 関連する問い合わせ(リンクで移動できる)
  await d.goto('#/inquiries/new');
  await d.waitHeading('問い合わせ登録');
  await d.setValue('#n-title', 'E2E: 関連あり');
  await d.setValue('#n-body', '関連する問い合わせを指定');
  await d.setValue('#n-requester', await d.optionValue('#n-requester', '田中 健太'));
  await d.setValue('#n-category', await d.optionValue('#n-category', 'PC・ネットワーク'));
  await d.setValue('#n-related', String(newId));
  await d.clickButton('登録');
  await page.waitFor(`/^#\\/inquiries\\/\\d+$/.test(location.hash) && document.querySelector('#view h2')?.textContent.includes('E2E: 関連あり')`);
  const linkHref = await page.eval(`[...document.querySelectorAll('#view dl a')].map((a) => a.getAttribute('href'))[0]`);
  check('登録: 関連する問い合わせを指定でき、詳細画面からリンクで移動できる', linkHref === `#/inquiries/${newId}`, linkHref);

  // S-03 詳細
  await d.goto(`#/inquiries/${newId}`);
  await d.waitHeading('E2E: 画面から登録');
  await d.shot('03-detail-open');
  await d.clickButton('対応中にする');
  check('詳細: 担当者が未割当のままステータスを変えようとすると、案内が出る', (await d.messageText()).includes('担当者を割り当ててください'));

  await d.setValue('#d-assignee', await d.optionValue('#d-assignee', '佐藤 花子'));
  await d.clickButton('割り当てる');
  await page.waitFor(`document.querySelector('#view dl')?.textContent.includes('佐藤 花子')`);
  check('詳細: 担当者を割り当てられる', (await d.messageText()).includes('担当者を割り当てました'));

  await d.clickButton('対応中にする');
  await page.waitFor(`document.querySelector('#view h2 .badge')?.textContent === '対応中'`);
  check('詳細: 対応中になり、ボタンが「保留にする」「完了にする」に変わる(不正な遷移のボタンは出ない)',
    (await d.buttonExists('保留にする')) && (await d.buttonExists('完了にする')) && !(await d.buttonExists('対応中にする')));

  await d.setValue('#d-comment', '進捗を確認しました');
  await d.clickButton('追加');
  await page.waitFor(`document.querySelector('ul.history')?.textContent.includes('コメント: 進捗を確認しました')`);
  check('詳細: コメントを追加でき、履歴に出る', true);

  // 別の担当者が先に更新した状況(画面を開いた後に、API で更新する)
  await page.eval(`(async () => {
    const d = await (await fetch('/api/inquiries/${newId}')).json();
    const r = await fetch('/api/inquiries/${newId}/assignee', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Operator-Id': ${J(yamada)} },
      body: JSON.stringify({ assigneeId: Number(${J(yamada)}), updatedAt: d.updatedAt }) });
    if (!r.ok) throw new Error('準備に失敗');
  })()`);
  await d.clickButton('保留にする');
  await page.waitFor(`document.querySelector('#messages')?.textContent.includes('他の担当者が先に更新しました')`);
  check('詳細: 他の人が先に更新していると、409 で拒否され、「再読み込み」を促される', await d.buttonExists('再読み込み'));
  await d.shot('04-detail-conflict');
  await d.clickButton('再読み込み');
  await page.waitFor(`document.querySelector('#view dl')?.textContent.includes('山田 太郎')`);
  check('詳細: 再読み込みで最新の担当者(山田 太郎)が表示される', true);
  await d.clickButton('保留にする');
  await page.waitFor(`document.querySelector('#view h2 .badge')?.textContent === '保留'`);
  check('詳細: 再読み込み後は、保留にできる', true);
  await d.clickButton('対応中に戻す');
  await page.waitFor(`document.querySelector('#view h2 .badge')?.textContent === '対応中'`);
  check('詳細: 保留から「対応中に戻す」ができる', true);

  await d.clickButton('完了にする');
  await page.waitFor(`document.getElementById('dialog').open === true`);
  check('詳細: 完了にするときは、対応内容の入力ダイアログが開く',
    await page.eval(`document.getElementById('dialog').textContent.includes('元に戻せません')`));
  await page.eval(`document.querySelector('#dialog button[type=submit]').click()`);
  check('詳細: 対応内容が未入力だと、ダイアログ内にエラーが出る', (await d.text('#c-resolution-error')) === '対応内容を入力してください');
  await d.shot('05-complete-dialog');
  await d.setValue('#c-resolution', 'あ'.repeat(51));
  await page.eval(`document.querySelector('#dialog button[type=submit]').click()`);
  check('詳細: 対応内容が51文字だと拒否される', (await d.text('#c-resolution-error')) === '対応内容は50文字以内で入力してください');
  await page.press('Escape');
  await page.waitFor(`document.getElementById('dialog').open === false`);
  check('キーボード: Esc キーでダイアログを閉じられる', (await d.text('#view h2 .badge')) === '対応中');
  await d.clickButton('完了にする');
  await page.waitFor(`document.getElementById('dialog').open === true`);
  await d.setValue('#c-resolution', '設定を修正した');
  await page.eval(`document.querySelector('#dialog button[type=submit]').click()`);
  await page.waitFor(`document.getElementById('dialog').open === false && document.querySelector('#view h2 .badge')?.textContent === '完了'`);
  check('詳細: 完了にすると、ダイアログが閉じてステータスが「完了」になる', (await d.messageText()).includes('完了にしました'));
  check('詳細: 完了後は対応時間・対応内容が表示される',
    await page.eval(`document.querySelector('#view dl').textContent.includes('対応時間') && document.querySelector('#view dl').textContent.includes('設定を修正した')`));
  check('詳細: 完了後は、編集・割当・ステータス変更の操作が無く、案内が出る(コメントのみ可)',
    !(await d.buttonExists('編集')) && !(await d.buttonExists('割り当てる')) && !(await d.buttonExists('保留にする'))
    && (await page.eval(`document.querySelector('#view').textContent.includes('完了済みのため編集できません')`)));
  check('詳細: 履歴にステータス変更と対応内容が残る',
    await page.eval(`document.querySelector('ul.history').textContent.includes('「対応中」から「完了」に変更(対応内容: 設定を修正した)')`));
  const historyTypes = await page.eval(`fetch('/api/inquiries/${newId}').then((r) => r.json()).then((d) => d.histories.map((h) => h.type))`);
  check('詳細: すべての変更操作(登録・担当者・ステータス・コメント)が履歴に残る',
    ['registered', 'assignee', 'status', 'comment'].every((t) => historyTypes.includes(t)), JSON.stringify(historyTypes));
  await d.shot('06-detail-done');

  await d.setValue('#d-comment', '完了後の連絡');
  await d.clickButton('追加');
  await page.waitFor(`document.querySelector('ul.history')?.textContent.includes('コメント: 完了後の連絡')`);
  check('詳細: 完了後もコメントは追加できる', true);

  // 編集
  const editId = await page.eval(`(async () => {
    const r = await fetch('/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operator-Id': ${J(yamada)} },
      body: JSON.stringify({ title: '編集前の件名', body: '内容', requesterId: 6, categoryId: 1, priority: '低' }) });
    return (await r.json()).id;
  })()`);
  await d.goto(`#/inquiries/${editId}`);
  await d.waitHeading('編集前の件名');
  await d.clickButton('編集');
  await page.waitFor(`document.querySelector('#e-title')`);
  await d.setValue('#e-title', '');
  await d.clickButton('保存');
  check('詳細: 編集で件名を空にすると、エラーが出る', (await d.text('#e-title-error')) === '件名を入力してください');
  await d.setValue('#e-title', 'E2E 編集後の件名');
  await d.setValue('#e-priority', '高');
  await d.clickButton('保存');
  await d.waitHeading('E2E 編集後の件名');
  check('詳細: 編集を保存すると、件名・優先度が更新され、履歴に残る',
    (await d.messageText()).includes('保存しました')
    && (await page.eval(`document.querySelector('ul.history').textContent.includes('件名・優先度を編集')`)));

  // キーボードだけの操作(要件定義書 7章「アクセシビリティ」)
  await d.goto('#/inquiries/new');
  await d.waitHeading('問い合わせ登録');
  await page.eval(`document.querySelector('#n-title').focus()`);
  const order = [];
  for (let i = 0; i < 9; i += 1) {
    order.push(await page.eval(`document.activeElement.id || document.activeElement.textContent.trim()`));
    await page.press('Tab');
  }
  check('キーボード: Tab キーで、全ての入力欄とボタンに順に移動できる',
    JSON.stringify(order.slice(0, 8)) === JSON.stringify(['n-title', 'n-body', 'n-requester', 'n-category', 'n-priority', 'n-related', '登録', 'キャンセル']),
    JSON.stringify(order));
  await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '登録').focus()`);
  check('キーボード: フォーカスされた要素に、フォーカスの表示(アウトライン)がある',
    (await page.eval(`getComputedStyle(document.activeElement).outlineStyle`)) !== 'none');
  await page.press('Enter');
  await page.waitFor(`document.querySelector('#n-title-error')?.textContent.length > 0`);
  check('キーボード: Enter キーでボタンを押せる(入力エラーが表示される)', (await d.text('#n-title-error')) === '件名を入力してください');

  // XSS
  await page.eval(`(async () => {
    await fetch('/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operator-Id': ${J(yamada)} },
      body: JSON.stringify({ title: '<img src=x onerror="window.__xss=1">', body: '<script>window.__xss=2</script>', requesterId: 6, categoryId: 1, priority: '中' }) });
  })()`);
  await d.goto('#/inquiries');
  await page.waitFor(`document.querySelector('#view tbody')?.textContent.includes('<img src=x')`);
  check('XSS: 一覧では、件名のタグは文字として表示され、実行されない',
    (await page.eval('window.__xss === undefined')) && (await d.count('#view img')) === 0);
  await page.eval(`[...document.querySelectorAll('#view tbody a')].find((a) => a.textContent.includes('<img')).click()`);
  await page.waitFor(`document.querySelector('#view h2')?.textContent.includes('<img src=x')`);
  check('XSS: 詳細でも、件名・内容は文字として表示され、実行されない',
    (await page.eval('window.__xss === undefined')) && (await d.count('#view img')) === 0 && (await d.count('#view script')) === 0);

  // 操作する担当者の保存
  await d.reload(`document.querySelector('#operator')?.options.length === 4`);
  check('操作する担当者: 再読み込みしても選択が保たれる', (await d.value('#operator')) === yamada);

  // 通信失敗
  await d.goto('#/inquiries');
  await d.waitHeading('問い合わせ一覧');
  await page.eval(`window.fetch = () => Promise.reject(new TypeError('Failed to fetch'))`);
  await d.clickButton('検索');
  await page.waitFor(`document.querySelector('#view')?.textContent.includes('通信に失敗しました')`);
  check('通信失敗: 内部情報を出さず、「通信に失敗しました」と「再読み込み」を表示する(データ無しとは別)',
    (await d.buttonExists('再読み込み')) && !(await page.eval(`document.querySelector('#view').textContent.includes('Failed to fetch')`)));
  await d.shot('07-network-error');

  const errors = d.consoleErrors();
  check('コンソールに例外・エラーが出ていない', errors.length === 0, JSON.stringify(errors));
}

// ---------- S-04 集計・S-05 マスタ管理 ----------
export async function reportsSuite({ d, check, baseUrl }) {
  const { page } = d;
  await page.goto(`${baseUrl}/`);
  await d.waitHeading('問い合わせ一覧');

  // 集計の期間: 最初の問い合わせの月の1日 〜 今日(サンプルデータは実行日を基準にした相対日付)
  const today = await page.eval(`(() => { const x = new Date(); const p = (n) => String(n).padStart(2, '0'); return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()); })()`);
  const earliest = await page.eval(`fetch('/api/inquiries?sort=received&dir=asc').then((r) => r.json()).then((d) => d.items[0].receivedAt)`);
  const from = `${earliest.slice(0, 7)}-01`;
  const expectedMonths = monthsBetween(from.slice(0, 7), today.slice(0, 7));

  await d.goto('#/reports');
  await d.waitHeading('集計');
  check('集計: 期間の既定は「当月1日〜今日」',
    (await d.value('#r-from')) === `${today.slice(0, 8)}01` && (await d.value('#r-to')) === today,
    `${await d.value('#r-from')} 〜 ${await d.value('#r-to')}`);
  check('集計: 月次保存の対象月の既定は先月', /^\d{4}-\d{2}$/.test(await d.value('#r-month')));

  await d.setValue('#r-from', from);
  await d.setValue('#r-to', today);
  await d.clickButton('表示');
  await page.waitFor(`location.hash.includes('from=${from}')`);
  await page.waitFor(`document.querySelectorAll('#view svg').length === 6`, { label: '6つのグラフ' });
  check('集計: 期間を指定すると、期間がURLに入り、6つの表とグラフが表示される(表とグラフの両方)',
    (await d.count('#view svg')) === 6 && (await d.count('#view section.panel table')) >= 6);
  const sections = await page.eval(`[...document.querySelectorAll('#view section h3')].map((h) => h.textContent)`);
  check('集計: A-01〜A-06 の見出しが並ぶ', ['A-01', 'A-02', 'A-03', 'A-04', 'A-05', 'A-06'].every((c) => sections.some((s) => s.startsWith(c))), JSON.stringify(sections));
  const sectionRows = (id) => page.eval(`[...document.querySelector('#report-${id}').closest('section').querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent))`);
  const a01 = await sectionRows('a01');
  check('集計: A-01 の件数がサンプルデータの手計算と一致する(5/3/4/2/1)', JSON.stringify(a01.map((r) => r[1])) === JSON.stringify(['5', '3', '4', '2', '1']), JSON.stringify(a01));
  const a06 = await sectionRows('a06');
  check('集計: A-06 のステータス別件数が一致する(未対応2・対応中2・保留1・完了10)',
    JSON.stringify(a06.map((r) => r[1])) === JSON.stringify(['2', '2', '1', '10']), JSON.stringify(a06));
  const a03 = await sectionRows('a03');
  check('集計: A-03 の完了0件のカテゴリは「-」と表示される', a03.some((r) => r[0] === 'その他' && r[2] === '-'), JSON.stringify(a03));
  const a05 = await sectionRows('a05');
  check('集計: A-05 は期間内のすべての月が並ぶ',
    JSON.stringify(a05.map((r) => r[0])) === JSON.stringify(expectedMonths.map((m) => m.replace('-', '/'))), JSON.stringify(a05));
  check('集計: グラフにタイトル(代替テキスト)があり、値のラベルが表示される',
    await page.eval(`[...document.querySelectorAll('#view svg')].every((s) => s.querySelector('title') && s.querySelectorAll('text').length > 0)`));
  check('集計: SVG内に script・イベント属性が無い',
    await page.eval(`document.querySelectorAll('#view svg script').length === 0 && ![...document.querySelectorAll('#view svg *')].some((e) => [...e.attributes].some((a) => a.name.startsWith('on')))`));
  await d.shot('10-reports');

  await d.setValue('#r-from', '2026-10-13');
  await d.setValue('#r-to', '2026-10-12');
  await d.clickButton('表示');
  check('集計: 開始日が終了日より後だと、項目のエラーが出て、集計は更新されない',
    (await d.text('#r-from-error')) === '開始日は終了日以前の日付にしてください' && (await d.attr('#r-from', 'aria-invalid')) === 'true'
    && (await page.eval('location.hash')).includes(`from=${from}`));
  await d.setValue('#r-from', '');
  await d.clickButton('表示');
  check('集計: 開始日が空だと「開始日を入力してください」', (await d.text('#r-from-error')) === '開始日を入力してください');

  // URLを手で書き換えた、極端に広い期間(10年超)。以前は、集計に約34秒かかり、サーバー全体が止まった
  await d.goto('#/reports?from=0100-01-01&to=9999-12-31');
  await page.waitFor(`document.querySelector('#messages')?.textContent.includes('集計期間は10年以内にしてください')`);
  check('集計: 10年を超える期間は、案内を出して、既定の期間に戻る(サーバーは止まらない)',
    (await d.value('#r-from')) === `${today.slice(0, 8)}01` && (await d.value('#r-to')) === today);
  await d.setValue('#r-from', '2000-01-01');
  await d.setValue('#r-to', today);
  await d.clickButton('表示');
  check('集計: 画面で10年を超える期間を指定すると、終了日の項目に「集計期間は10年以内にしてください」と出る',
    (await d.text('#r-to-error')) === '集計期間は10年以内にしてください' && (await d.attr('#r-to', 'aria-invalid')) === 'true');

  await d.goto('#/reports?from=2020-01-01&to=2020-01-31');
  await page.waitFor(`document.querySelector('#view')?.textContent.includes('該当するデータはありません')`);
  check('集計: 該当するデータが無い期間では、案内を表示しグラフは出さない', (await d.count('#view svg')) === 0);

  await d.goto(`#/reports?from=${from}&to=${today}`);
  await page.waitFor(`document.querySelectorAll('#view svg').length === 6`);
  const csvHref = await page.eval(`document.querySelector('#report-a01').closest('section').querySelector('a[download]').getAttribute('href')`);
  check('集計: CSV出力のリンクが、種類と期間を持つ', csvHref === `/api/reports/export.csv?type=a01&from=${from}&to=${today}`, csvHref);
  const csv = await page.eval(`(async () => { const r = await fetch(${J(csvHref)}); const b = new Uint8Array(await r.arrayBuffer()); return { type: r.headers.get('content-type'), bom: [...b.slice(0, 3)], head: new TextDecoder().decode(b).replace(/^\\uFEFF/, '').split('\\r\\n')[0] }; })()`);
  check('集計: CSV出力は text/csv・UTF-8(BOM付き)で、ヘッダーが正しい',
    csv.type.includes('text/csv') && JSON.stringify(csv.bom) === '[239,187,191]' && csv.head === 'カテゴリ,件数', JSON.stringify(csv));

  // 月次保存
  check('月次保存: 操作する担当者が未選択の間は、保存ボタンが無効',
    await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '月次集計を保存').disabled`));
  check('月次保存: 保存済みの月が無いときの表示', await page.eval(`document.querySelector('#view').textContent.includes('保存済みの月はありません')`));
  await d.setValue('#operator', await d.optionValue('#operator', '山田 太郎'));
  const month = await d.value('#r-month');
  const monthText = month.replace('-', '/');
  await d.clickButton('月次集計を保存');
  await d.waitMessage(`${monthText}の集計を保存しました`);
  const savedTable = `[...document.querySelectorAll('#view h3')].find((h) => h.textContent === '保存済みの月').nextElementSibling.querySelector('table')`;
  const savedRows = await page.eval(`${savedTable}.querySelectorAll('tbody tr').length`);
  const savedMonth = await page.eval(`${savedTable}.querySelector('tbody tr td').textContent`);
  check('月次保存: 保存すると、保存済みの一覧に、その月の行が1つ出る', savedRows === 1 && savedMonth === monthText, `${savedRows}行 ${savedMonth}`);
  const links = await page.eval(`[...document.querySelectorAll('#view a[download]')].filter((a) => a.getAttribute('href').startsWith('/api/reports/monthly/${month}/')).map((a) => a.getAttribute('href'))`);
  check('月次保存: CSV 6 + SVG 6 のダウンロードリンクが並ぶ(A-01〜A-06 のCSVとSVG)', links.length === 12, links.length);
  const svg = await page.eval(`(async () => { const r = await fetch('/api/reports/monthly/${month}/a05.svg'); const t = await r.text(); return { type: r.headers.get('content-type'), head: t.slice(0, 5) }; })()`);
  check('月次保存: 保存したSVGをダウンロードできる', svg.type.includes('image/svg+xml') && svg.head === '<?xml', JSON.stringify(svg));
  const savedAt1 = await page.eval(`${savedTable}.querySelector('tbody tr td:nth-child(2)').textContent`);
  await d.shot('11-reports-saved');

  await d.clickButton('月次集計を保存');
  await page.waitFor(`document.getElementById('dialog').open === true`);
  check('月次保存: 保存済みの月は、上書きの確認ダイアログが出る',
    await page.eval(`document.getElementById('dialog').textContent.includes('${monthText}は保存済みです。上書きします。')`));
  await d.clickButton('キャンセル', `document.getElementById('dialog')`);
  await page.waitFor(`document.getElementById('dialog').open === false`);
  const savedAtAfterCancel = await page.eval(`${savedTable}.querySelector('tbody tr td:nth-child(2)').textContent`);
  check('月次保存: キャンセルすると、上書きされない(保存日時が変わらない)', savedAtAfterCancel === savedAt1);
  await d.clickButton('月次集計を保存');
  await page.waitFor(`document.getElementById('dialog').open === true`);
  await d.clickButton('上書きして保存', `document.getElementById('dialog')`);
  await page.waitFor(`document.getElementById('dialog').open === false`);
  await d.waitMessage(`${monthText}の集計を保存しました`);
  check('月次保存: 確認すると上書き保存され、一覧は重複しない',
    (await page.eval(`${savedTable}.querySelectorAll('tbody tr').length`)) === 1);

  // S-05 マスタ管理
  await d.goto('#/masters');
  await d.waitHeading('マスタ管理');
  check('マスタ: 社員の一覧(10名)とタブが表示される',
    (await d.count('#view tbody tr')) === 10 && (await d.attr('[role=tab][aria-selected=true]', 'aria-selected')) === 'true');

  await d.clickButton('追加');
  check('マスタ: 社員の追加で未入力だと、項目のエラーが出る',
    (await d.text('#a-name-error')) === '氏名を入力してください' && (await d.text('#a-dept-error')) === '部署を入力してください');
  await d.setValue('#a-name', '中村 次郎');
  await d.setValue('#a-dept', '開発');
  await d.clickButton('追加');
  await d.waitMessage('中村 次郎を追加しました');
  check('マスタ: 社員を追加できる(一般)', (await d.count('#view tbody tr')) === 11);

  await d.clickRowButton('中村 次郎', '編集');
  await page.waitFor(`[...document.querySelectorAll('#view tbody input')].some((i) => i.value === '中村 次郎')`);
  await page.eval(`(() => { const tr = [...document.querySelectorAll('#view tbody tr')].find((r) => [...r.querySelectorAll('input')].some((i) => i.value === '中村 次郎')); const dept = tr.querySelectorAll('input')[1]; dept.value = '総務'; dept.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await d.clickRowButton('中村 次郎', '保存');
  await d.waitMessage('保存しました');
  const nakamura = (await d.rowsOf('#view table')).find((r) => r[0] === '中村 次郎');
  check('マスタ: 行内で編集して保存できる', nakamura && nakamura[1] === '総務', JSON.stringify(nakamura));

  await d.clickRowButton('中村 次郎', '無効にする');
  await d.waitMessage('中村 次郎を無効にしました');
  const nakamura2 = (await d.rowsOf('#view table')).find((r) => r[0] === '中村 次郎');
  check('マスタ: 無効にすると状態が「無効」になり、ボタンが「有効にする」になる', nakamura2[3] === '無効' && nakamura2[4].includes('有効にする'), JSON.stringify(nakamura2));

  // 担当案件のある担当者(サンプルデータでは、担当が未完了の社員)を探す
  const busy = await page.eval(`(async () => {
    const open = (await (await fetch('/api/inquiries?status=' + encodeURIComponent('対応中'))).json()).items;
    return open.find((i) => i.assignee).assignee.name;
  })()`);
  await d.clickRowButton(busy, '無効にする');
  await d.waitMessage('未完了の問い合わせの担当者になっているため、無効にできません');
  const busyRow = (await d.rowsOf('#view table')).find((r) => r[0] === busy);
  check('マスタ: 未完了の担当案件がある担当者は、無効にできない(理由が表示され、状態は変わらない)', busyRow[3] === '有効', JSON.stringify(busyRow));

  await d.clickRowButton(busy, '編集');
  await page.waitFor(`document.querySelectorAll('#view tbody select').length > 0`);
  await page.eval(`(() => { const s = document.querySelector('#view tbody select'); s.value = '0'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await d.clickRowButton(busy, '保存');
  await d.waitMessage('担当者区分を変更できません');
  check('マスタ: 未完了の担当案件がある担当者は、担当者区分を「一般」にできない', true);
  await d.clickRowButton(busy, 'キャンセル');

  const before = await d.count('#operator option');
  await d.setValue('#a-name', '新任 担当');
  await d.setValue('#a-dept', '情報システム');
  await d.setValue('#a-staff', '1');
  await d.clickButton('追加');
  await d.waitMessage('新任 担当を追加しました');
  check('マスタ: 担当者区分の社員を追加すると、「操作する担当者」の選択肢が増える',
    (await d.count('#operator option')) === before + 1, `${before} → ${await d.count('#operator option')}`);
  await d.shot('12-masters');

  await page.eval(`[...document.querySelectorAll('[role=tab]')].find((b) => b.textContent === 'カテゴリ').click()`);
  await page.waitFor(`document.querySelector('#add-title')?.textContent === 'カテゴリを追加'`);
  check('マスタ: カテゴリの一覧(初期5種)が表示される', (await d.count('#view tbody tr')) === 5);
  check('マスタ: カテゴリの表示順の既定は、最後の次の番号', (await d.value('#a-order')) === '6');
  await d.setValue('#a-name', 'PC・ネットワーク');
  await d.clickButton('追加');
  await page.waitFor(`document.querySelector('#a-name-error')?.textContent.length > 0`);
  check('マスタ: 重複する名称は、名称の項目に「同じ名称のカテゴリがあります」と表示される',
    (await d.text('#a-name-error')) === '同じ名称のカテゴリがあります' && (await d.attr('#a-name', 'aria-invalid')) === 'true');
  await d.setValue('#a-name', 'あ'.repeat(51));
  await d.clickButton('追加');
  check('マスタ: カテゴリ名が51文字だと拒否される', (await d.text('#a-name-error')) === '名称は50文字以内で入力してください');
  await d.setValue('#a-name', 'E2Eカテゴリ');
  await d.clickButton('追加');
  await d.waitMessage('E2Eカテゴリを追加しました');
  check('マスタ: カテゴリを追加できる', (await d.count('#view tbody tr')) === 6);
  await d.clickRowButton('E2Eカテゴリ', '無効にする');
  await d.waitMessage('E2Eカテゴリを無効にしました');
  check('マスタ: カテゴリを無効にできる', ((await d.rowsOf('#view table')).find((r) => r[0] === 'E2Eカテゴリ') ?? [])[2] === '無効');

  await d.goto('#/inquiries/new');
  await d.waitHeading('問い合わせ登録');
  check('マスタ: 無効にしたカテゴリは、登録画面の選択肢に出ない', (await d.optionValue('#n-category', 'E2Eカテゴリ')) === null);

  const errors = d.consoleErrors();
  check('コンソールに例外・エラーが出ていない', errors.length === 0, JSON.stringify(errors));
}

// ---------- 初期セットアップ(空のDB) ----------
export async function bootstrapSuite({ d, check, baseUrl }) {
  const { page } = d;
  await page.goto(`${baseUrl}/`);
  await d.waitHeading('問い合わせ一覧');
  await d.goto('#/masters');
  await d.waitHeading('マスタ管理');
  check('初期セットアップ: 担当者がいないとき、案内が表示される', (await d.messageText()).includes('まだ担当者が登録されていません'));
  check('初期セットアップ: 操作する担当者の選択肢は無い(未選択のみ)', (await d.count('#operator option')) === 1);
  check('初期セットアップ: 追加ボタンは、操作者なしでも有効',
    await page.eval(`![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '追加').disabled`));
  check('初期セットアップ: 担当者区分の既定は「担当者」', (await d.value('#a-staff')) === '1');
  await d.shot('13-bootstrap');

  await d.setValue('#a-name', '初代 担当');
  await d.setValue('#a-dept', '情報システム');
  await d.clickButton('追加');
  await d.waitMessage('操作する担当者に設定しました');
  check('初期セットアップ: 最初の担当者を追加すると、操作する担当者に自動で設定される',
    (await page.eval(`document.querySelector('#operator').selectedOptions[0].textContent`)) === '初代 担当');

  await page.eval(`[...document.querySelectorAll('[role=tab]')].find((b) => b.textContent === 'カテゴリ').click()`);
  await page.waitFor(`document.querySelector('#add-title')?.textContent === 'カテゴリを追加'`);
  const cats = (await d.rowsOf('#view table')).map((r) => r[0]);
  check('初期セットアップ: カテゴリの初期値(5種)が作られている',
    JSON.stringify(cats) === JSON.stringify(['PC・ネットワーク', 'アカウント・権限', '備品・ソフト申請', '入退社手続き', 'その他']), JSON.stringify(cats));

  await d.goto('#/inquiries/new');
  await d.waitHeading('問い合わせ登録');
  await d.setValue('#n-title', '初回の問い合わせ');
  await d.setValue('#n-body', '動作確認');
  await d.setValue('#n-requester', await d.optionValue('#n-requester', '初代 担当'));
  await d.setValue('#n-category', await d.optionValue('#n-category', 'PC・ネットワーク'));
  await d.clickButton('登録');
  await page.waitFor(`/^#\\/inquiries\\/\\d+$/.test(location.hash)`);
  await d.waitHeading('初回の問い合わせ');
  check('初期セットアップ: そのまま問い合わせを登録できる', (await d.text('#view h2 .badge')) === '未対応');

  await d.reload(`document.querySelector('#operator')?.options.length === 2`);
  check('初期セットアップ: 再読み込み後も、操作する担当者が保たれる',
    (await page.eval(`document.querySelector('#operator').selectedOptions[0].textContent`)) === '初代 担当');

  const errors = d.consoleErrors();
  check('コンソールに例外・エラーが出ていない', errors.length === 0, JSON.stringify(errors));
}

export const SUITES = [
  { name: '問い合わせ(S-01〜S-03・キーボード・XSS)', seed: true, run: inquiriesSuite },
  { name: '集計・マスタ管理(S-04・S-05)', seed: true, run: reportsSuite },
  { name: '初期セットアップ(空のDB)', seed: false, run: bootstrapSuite },
];
