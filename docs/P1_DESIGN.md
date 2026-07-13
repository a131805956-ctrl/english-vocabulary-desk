# P1 設計規格：詞素索引卡

## 產品焦點

- 使用者：使用繁中介面的 TOEIC／英文自學者。
- 單一工作：選取字首、字根或多個 UNIT，完成一輪主動回想。
- 視覺概念：冷調的「詞素索引卡」，讓分類與單字結構成為介面本身。
- 真實資料：574 個不重複單字、582 筆來源紀錄、字首 327、字根 255、13 個 UNIT。

## Tokens

```css
:root {
  --color-canvas: #f3f6fa;
  --color-surface: #ffffff;
  --color-ink: #172033;
  --color-morph: #2457d6;
  --color-good: #167260;
  --color-again: #b94738;
  --font-term: "Palatino Linotype", "Book Antiqua", Palatino, serif;
  --font-body: "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif;
  --font-data: "Cascadia Mono", "Segoe UI Mono", Consolas, monospace;
}
```

## Signature

「詞素脊線」是卡片左緣固定 6px cobalt 書脊。翻面以脊線為鉸鏈；背面把解碼展開成等寬詞素格。前面不顯示解碼，避免洩漏答案。這是唯一醒目的品牌動效，其餘介面保持安靜。

## 桌面

```text
┌─────────┬─────────────────────────────────────┬────────────┐
│ 今日     │ 英單1 · 574 個單字                  │ 本次範圍    │
│ 範圍     │ 582 筆來源紀錄，跨分類自動去重       │ 字首 327    │
│ 統計     │                                     │ 字根 255    │
│ 設定     │ 字首 > UNIT 1 > an / anci / anti   │ 13 UNIT     │
│         │ ┌─────────────────────────────────┐ │            │
│         │ ┃ ancestor                    發音 │ │ 今日到期   │
│         │ ┃ /`ænsɛstɚ/ · 名                 │ │ 今日複習   │
│         │ ┃       點擊查看答案               │ │ 今日忘記   │
│         │ └─────────────────────────────────┘ │ [更改範圍] │
│         │ [← 不知道 / Again] n / N [知道 →]  │            │
└─────────┴─────────────────────────────────────┴────────────┘
```

桌面採 `224px minmax(520px, 760px) 280px` 三欄；720–1023px 隱藏側欄；小於 720px 單欄並使用 bottom sheet 範圍選擇器。

## 卡片與互動

- 正面：headword、IPA、詞性與發音。
- 背面：中文定義、詞素解碼、同反義、英文例句與中文例句。
- 點擊、Enter、Space 翻面。
- 左拖、A、左方向鍵：Again；右拖、G、右方向鍵：Good。
- S 播放發音；Esc 關閉 drawer。
- 拖曳門檻 72px 或卡寬 22%；評分按鈕永久存在，不能只靠顏色或手勢。
- focus target 至少 44px；focus ring 3px；結果用 `aria-live` 宣告。
- `prefers-reduced-motion` 下取消 3D 翻面，改成短 crossfade。

## 範圍規則

- Range tree 使用 checkbox，不用大量 chips。
- 多選結果聯集 `lexeme_ids`，同字不同來源不重複出卡。
- 字首 021 顯示 disabled「來源缺頁」；字首 022 顯示「推定分類」。
- 同 lexeme 多筆來源時可切換 entry，但共用 FSRS 狀態。

## 自我批判

刪除「四張漸層 KPI 卡 + 火焰 streak」首頁。它適用於任何學習 App，不能反映字首／字根資料，也與不把 streak 當主要成效指標的產品原則衝突。改成單一 Session Ledger，只呈現今日到期、今日複習與今日忘記。

