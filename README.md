# InquiryManagement(問い合わせ管理)

問い合わせの登録・一覧・ステータス管理・担当者割当・履歴を扱うアプリ。課題として作成する。

## 技術スタック

- Node.js v24 以降(標準の `node:sqlite` を使用)
- SQLite(ファイル DB)
- HTML / 素のJavaScript

課金が発生する技術・サービスは使わず、ローカルだけで動作する。

## 起動とテスト

```
npm start        # http://localhost:8080/ で起動(localhost のみ)
npm run seed    # サンプルデータ(社員10名、問い合わせ15件)を投入。既にデータがあれば何もしない
npm test        # 自動テスト
```

初回起動時にカテゴリの初期値(5種)を作成する。サンプルデータを使わない場合は、最初の担当者を、操作者なしで登録できる(担当者がいる間は、操作者が必須)。

環境変数 `PORT`(既定 8080)、`DB_PATH`(既定 `data/inquiry.db`)で上書きできる。初回起動時にDBとテーブルを自動で作成する。

## ドキュメント

- [題材の選定理由](docs/selection-rationale.md)
- [要件定義書](docs/requirements.md)(ユースケース図: [SVG版](docs/diagrams/use-case.svg))
- [画面設計書](docs/screen-design.md)
- [画面サンプル](docs/mockups/screen-sample.html)(Chromeで開いて確認する)
- [API設計・DB定義](docs/api-design.md)(正)と、[説明用の図解](docs/mockups/api-overview.html)(Chromeで開いて確認する)

## 開発ルール

[CLAUDE.md](CLAUDE.md) を参照。
