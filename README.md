# AddPick (Public Mirror)

> 📘 **詳細ドキュメント**：HTML 版 README  
> 👉 `README.html`（または `docs/README.html` に配置してください）

インフルエンサーと企業の広告依頼をつなぐ Web アプリ（学習・ポートフォリオ向け公開版）。

## 機能
- 企業: 広告依頼の投稿 / 応募管理 / 購入者一覧（対応済みフラグ）
- インフルエンサー: 依頼一覧 / 応募
- 共通: 認証 / プロフィール編集 / ダッシュボード（簡易）

> 本リポは機密を除いた**公開用ミラー**です。本番鍵や秘密設定は含みません。

## 技術スタック
- Node.js (Express), EJS, SQLite
- ミドルウェア: express-session, csurf, multer, bcrypt, Helmet(一部)
- Bootstrap ベースのUI

---

## 🏁 Quick Start

```bash
git clone https://github.com/a23i246/addpick-public.git
cd addpick-public

# 環境変数
cp .env.example .env
# .env の DB を一本化
# DB_PATH=./database.sqlite
# DEMO_MODE=true
# SESSION_SECRET=change_me
# CSRF_SECRET=change_me

npm ci

# 404/500 テンプレが無いと一部ルートで落ちるため、views/ に置く(いずれ準備予定)
# views/404.ejs, views/500.ejs を準備（簡易テンプレでOK）

# 画像以外の全列を埋めるデモデータ投入
npm run db:seed-full

# 起動
npm start
# http://localhost:3000

デモ用アカウント　パスワードはすべてpass1234
Admin: admin@addpick.local #管理者
Company: company@example.com #企業
Influencer: influencer@example.com #ユーザー
Buyer: buyer@example.com #ロールが不明なため入れません