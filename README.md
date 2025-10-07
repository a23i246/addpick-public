# AddPick (Public Mirror)

> 📘 **詳細ドキュメント**：HTML 版 README  
> 👉 `README.html`　詳しい解説はこちらで行っております

インフルエンサーと企業の広告依頼をつなぐ Web アプリ（学習・ポートフォリオ向け公開版）。
企業閲覧用のパブリック版なのでいくつかの機能は停止もしくは未完成のまま掲載しています。

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

# 1) 環境変数
Copy-Item .env.example .env
# .env を開いて次を確認/編集:
# NODE_ENV=development
# DB_PATH=./database.sqlite
# DEMO_MODE=false   # デモ裏口は既定OFFでOK（シードで全員ログイン可）
# SESSION_SECRET=change_me
# CSRF_SECRET=change_me
# UPLOAD_DIR=uploads

# 2) 依存インストール
npm ci   # 失敗時は npm install

# 3) 404/500 テンプレ（未作成なら最小版を作成）
'<!doctype html><meta charset="utf-8"><h1>404</h1><p><%= message || "Not Found" %></p>' `
  | Out-File -Encoding UTF8 -FilePath .\views\404.ejs
'<!doctype html><meta charset="utf-8"><h1>エラー</h1><pre><%= (error && error.message) || "" %></pre>' `
  | Out-File -Encoding UTF8 -FilePath .\views\500.ejs

# 4) スキーマ作成のため一度だけ起動（カテゴリと管理者が自動生成される）
# ログに [DB] using ./database.sqlite や「カテゴリ初期投入」「管理者作成」が出ればOK
# (重要)そのまま Ctrl + C で停止
npm start

# 5) デモデータ投入（画像以外の全列を充填）
npm run db:seed-full

# 6) 本起動
npm start
# → http://localhost:3000

デモ用アカウント　パスワードはすべてpass1234
Admin: admin@addpick.local #管理者
Company: company@example.com #企業
Influencer: influencer@example.com #ユーザー

Buyer: buyer@example.com #ロールが不明なため入れません

