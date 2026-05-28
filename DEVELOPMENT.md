# kakezan-app 開発メモ

子供向け掛け算ドリル。回答時間を測って苦手な掛け算を重点的に出題する。

このドキュメントは「今後開発を続けるためのマトメ」。ユーザー向け説明ではなく、
コードの構造・設計判断・調整ポイントを残すためのもの。

---

## 1. スタック

| レイヤ | 採用 |
|---|---|
| フレームワーク | SvelteKit 2 + Svelte 5（runes モード強制）|
| スタイル | Tailwind CSS 4 |
| DB | SQLite（`better-sqlite3`）|
| ORM | Drizzle ORM 0.45 + drizzle-kit 0.31 |
| 言語 | TypeScript |

ランタイム想定はローカル開発。`adapter-auto`、`DATABASE_URL=local.db`。

---

## 2. ディレクトリ

```
src/
├── routes/
│   ├── +layout.svelte         # Tailwind import + favicon
│   ├── +page.svelte           # アプリ本体（ステートマシン + UI）
│   └── api/
│       ├── answertimes/+server.ts   # GET / POST / DELETE  記録
│       ├── weakorder/+server.ts     # GET  弱点順
│       └── quizzes/+server.ts       # GET  重み付き抽選で出題リストを返す
└── lib/server/db/
    ├── index.ts               # drizzle インスタンス
    └── schema.ts              # テーブル定義
```

`src/lib/server/` は SvelteKit のサーバ専用領域。ブラウザバンドルに混入しない。

---

## 3. データモデル

### `answer_times`

| カラム | 型 | 説明 |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `a`, `b` | INTEGER NOT NULL | 出題された掛け算の左辺・右辺。**順序を保持** |
| `answer_time` | REAL NOT NULL | **最新試行** の回答時間（秒） |
| `avg_answer_time` | REAL NOT NULL | EWMA（重み付き移動平均） |
| `tries` | INTEGER NOT NULL DEFAULT 0 | 累積試行回数 |
| `updated` | INTEGER NOT NULL (timestamp) | 最終更新時刻 |

ユニーク制約：`uniq_a_b ON (a, b)` で 1 ペア 1 行を保証。
**正規化していない**（`5×6` と `6×5` は別行）。子供にとっては別の体感の問題なので、別データのほうが扱いやすい想定。

### `task`（旧テンプレ由来、未使用）

削除可。残しているのは Drizzle のスケルトンと衝突しないように。

### マイグレーション

```bash
npm run db:push -- --force
```

⚠ `drizzle-kit push` は新規 NOT NULL カラム追加時に「念のため delete from」をかける挙動がある。
本番データが乗る前にきちんと `drizzle-kit generate` でマイグレーション運用に切り替えるべき。

---

## 4. API 一覧

### `POST /api/answertimes`

Body: `{ a: int, b: int, answerTime: number }`

UPSERT：
- 新規 → `avg_answer_time = answerTime`、`tries = 1`
- 既存 → `avg_answer_time = α·新値 + (1−α)·旧値`（EWMA）、`tries += 1`

`α = 0.5` を `+server.ts` 冒頭で定義。

### `GET /api/answertimes`

全行を `updated DESC` で返す。形：

```json
[{ "question": "5x6", "a": 5, "b": 6,
   "answerTime": 1.23, "avgAnswerTime": 2.34, "try": 7,
   "updated": "2026-..." }]
```

### `DELETE /api/answertimes`

`answer_times` テーブル全消去。確認ダイアログはクライアント側。

### `GET /api/weakorder`

`avg_answer_time DESC` で返す。`rank` 付き。
「どの掛け算が苦手か」を確認する閲覧用。

### `GET /api/quizzes?count=N`

**出題セットの生成器。**
1. 2..9 × 2..9 = 64 問の全候補を作る
2. 各候補の重み = `avg_answer_time`（未出題は `UNSEEN_WEIGHT = 10`）
3. Efraimidis–Spirakis サンプリングで重複なく N 問抽出
4. `[{a, b}, ...]` を返す

`count` 範囲：1〜64。デフォルト 10。

---

## 5. フロントエンドの状態機械

`+page.svelte` 内 `phase: Phase`。

```
idle  ──スタート──▶  playing  ─Enter/timeout─▶  feedback
  ▲                     ▲                          │
  │                     └──次の問題────────────────┘
  │
  └─（リセット導線なし、画面遷移のみ）
                                                   │
                                          全問終了 ▼
                          finished  ─Enter or 各ボタン─▶  retry / practiceAgain
                          ・retry        : 不正解だけで次ラウンド
                          ・practiceAgain: 新しい10問を /api/quizzes から取得
```

### キー操作

- `playing`：入力中の Enter で `handleSubmit`
- `finished`：`<svelte:window onkeydown>` で Enter を捕捉
  - `retryCount > 0` → `retry()`
  - それ以外 → `practiceAgain()`

### タイマー

`requestAnimationFrame` ループ。`ANSWER_LIMIT = 10s` で `submitResult('wrong', null)`。
`feedback` への遷移時に `cancelAnimationFrame`。

---

## 6. 主要な定数（チューニング箇所）

`src/routes/+page.svelte`：

| 定数 | 値 | 意味 |
|---|---|---|
| `DEFAULT_QUESTION_COUNT` | 10 | スタート画面の初期値 |
| `TIME_LIMIT` | 5 | 「覚えてる」境界（秒） |
| `MEMORIZED_LIMIT` | = TIME_LIMIT | 〃 |
| `ANSWER_LIMIT` | = TIME_LIMIT * 2 | タイムアウト・wrong 記録時の `answerTime` |
| `FEEDBACK_MS` | 1400 | 正解／不正解表示の滞在時間 |

`src/routes/api/answertimes/+server.ts`：

| 定数 | 値 | 意味 |
|---|---|---|
| `ALPHA` | 0.5 | EWMA の新値の重み（大きい = 直近を重視） |

`src/routes/api/quizzes/+server.ts`：

| 定数 | 値 | 意味 |
|---|---|---|
| `MIN_FACTOR` / `MAX_FACTOR` | 2 / 9 | 出題範囲 |
| `UNSEEN_WEIGHT` | 10 | 未出題問題の優先度（ANSWER_LIMIT と同値）|
| `MAX_COUNT` | 64 | 1 セットの上限 |

---

## 7. アルゴリズム

### EWMA（重み付き移動平均）

```
new_avg = α · latest + (1 − α) · old_avg
```

SQL に埋め込んで UPSERT で一発更新（`onConflictDoUpdate`）。

### 重み付き抽選（Efraimidis–Spirakis）

```ts
key_i = log(u_i) / w_i      // u_i ~ Uniform(0,1)
```

`key` 上位 N を取れば、抽選確率 ∝ 重みで重複なし N 個を得られる。
`u^(1/w)` と等価なランク付け、`log` 形は w 幅が広くても数値安定。

### 出題ロジックの記録方針

`+page.svelte` の `submitResult`：

- `round === 1` のときだけ DB に POST する（リトライ周回はノイズなので除外）
- `wrong / timeout` は `ANSWER_LIMIT` を記録（実時間ではなく上限値）
- `memorized / vague` は実際の `elapsed` を記録

---

## 8. 既知の限界・宿題

- **乱用防止なし**：F5 連打で `practiceAgain` を連発できる。 rate-limit 等なし。
- **問題範囲固定**：2..9 で 8×8。九九（1..9）にする・10 を加える等は `MIN/MAX_FACTOR` を触るだけだが、UI 側のレイアウト・DB 既存行への影響に注意。
- **`task` テーブルが残骸**：未使用。掃除しても良い。
- **マイグレーション戦略**：今は `db:push --force` 運用。本番想定するなら `db:generate` + `db:migrate` に切り替え。
- **記録単位の粒度**：`(a, b)` の順序を区別している。「九九として同一視」したい場合は POST 時に `min(a,b), max(a,b)` に正規化するのが最小変更。
- **エラー処理**：API 失敗時はクライアント側で `console.warn` のみ。ユーザに見えるリトライ UI なし。
- **テストなし**：`svelte-check` のみ。ロジック（EWMA、重み付き抽選）はピュア関数化して単体テストしたい。
- **オフライン未対応**：DB はサーバ側。SPA / PWA 化するなら IndexedDB + 同期戦略が要る。

---

## 9. 次にやりたい候補（優先順位の高い順）

1. **苦手・得意の可視化ページ**：`/stats` で表 or ヒートマップ（9×9 グリッド）。データはもう揃っている。
2. **EWMA / α / UNSEEN_WEIGHT のチューニング UI**：管理画面のように `settings.local.json` に書き出すか、URL クエリで実験的に切替。
3. **ハイブリッド出題（案⑤）への進化**：
   - 必ず弱点トップ3
   - 残りは重み付き
   - 1〜2 問は未出題優先
4. **複数ユーザ対応**：今は単一 DB。`user_id` を `answer_times` に足し、`/api/*` を認証付きに。
5. **テスト基盤**：vitest を入れて `weightedSampleWithoutReplacement` と EWMA 計算をテスト。
6. **キーボード以外**：タッチ用に数字パッド UI。スマホ / タブレット利用時の体験向上。

---

## 10. ローカル開発メモ

```bash
npm install
npm run db:push -- --force    # 初回 / スキーマ更新時
npm run dev                   # http://localhost:5173

npm run check                 # svelte-check（CI 用）
npm run lint                  # prettier + eslint
npm run format                # 自動整形
```

`.env`：

```
DATABASE_URL=local.db
```

DB の中身を確認：

```bash
sqlite3 local.db
> .schema
> SELECT * FROM answer_times ORDER BY avg_answer_time DESC;
```
