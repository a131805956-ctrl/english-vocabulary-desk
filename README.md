# 詞素桌 Morpheme Desk

以這個資料夾的單字書為來源，建立可持續擴充的本機單字 App。現在已包含資料範圍、翻面單字卡、範圍合併、英文發音、錯題專練、FSRS 今日排程與本機 AI 選字產文。

## 最快啟動方式

雙擊專案根目錄的 `啟動單字App.cmd`。它會自動：

1. 安裝缺少的套件。
2. 建置最新版介面。
3. 開啟 `http://127.0.0.1:4173`。

保持命令視窗開啟即可使用；關閉視窗會停止 App。

也可以在 PowerShell 手動執行：

```powershell
cd C:\Users\10931\Desktop\英文單字\vocab-app
npm install
npm run build
npm start
```

開發模式：

```powershell
npm run dev
```

## 目前功能

- 點擊／`Space`／`Enter` 翻面。
- 左滑或 `A`／`←`：不知道（Again）。
- 右滑或 `G`／`→`：知道（Good）。
- `S` 或喇叭按鈕播放英文發音。
- 依全部、字首、字根、UNIT、細部分組選取範圍。
- 可同時選多個範圍；後端以 lexeme 聯集精確去重。
- 每輪可選 20、40、80 或全部，並可照書本順序或隨機出題。
- 卡片背面顯示中文定義、詞素拆解、同反義與雙語例句。
- Again／Good 寫入獨立 SQLite，使用 `ts-fsrs 5.4.1 / FSRS-6` 排定下次複習。
- 「今日複習」先出到期卡，再依設定加入新字；尚未到期的卡不會提早混入。
- 可切換「自由練習」，忽略排程並直接練選取範圍。
- 記錄回答次數、知道比例、反應時間與錯題排行，並可一鍵建立錯題專練。
- 文章工房可勾選 3–12 個本輪單字，設定程度與長度，生成英文文章、繁中翻譯及理解題。
- 每篇生成文章會自動保存到本機學習資料庫；「閱讀索引」會先顯示主題與使用單字，可點開閱讀全文，刪除需再確認一次。

## 連接文章生成器

App 會由本機 Node 服務代為連線，不讓瀏覽器直接呼叫模型，也不保存 API 金鑰。為避免把它變成網路代理，本機模型位址只接受 `localhost`、`127.0.0.1` 或 `[::1]`。

1. 先啟動 Ollama、LM Studio 或其他 OpenAI 相容的本機服務。
2. 在 App 的「設定」填入位址與已安裝／已載入的模型名稱。
3. 到「文章」，勾選單字後按「生成練習文章」。

常見設定：

- Ollama：`http://127.0.0.1:11434`
- LM Studio／OpenAI 相容：`http://127.0.0.1:1234/v1`

也可在「設定」把文章生成器改成 **Hermes Agent**。它會使用 Hermes 現有的登入與預設模型，不需要位址、模型名稱或 API 金鑰；文章呼叫會明確停用 Hermes 的檔案、終端、瀏覽和技能工具，只要求回傳文章 JSON。

若沒有指定模型、Hermes 尚未登入，或本機服務尚未啟動，文章面板會保留單字選擇並顯示可理解的連線錯誤。

## 資料安全

- 詞庫：`data/generated/vocabulary.sqlite3`，App 只讀開啟。
- 學習進度：`data/runtime/progress.sqlite3`，與詞庫分開保存。
- 原始資料與後續匯入：`imports/`。

重新整理單字範圍：

```powershell
python .\scripts\build_scope.py
```

主要生成物：

- `data/generated/vocabulary.json`
- `data/generated/ranges.json`
- `data/generated/vocabulary.sqlite3`
- `data/generated/vocabulary_review.csv`
- `data/generated/validation_report.json`
- `data/generated/quality_report.json`

## 驗證

```powershell
npm run check
```

這會執行 TypeScript 檢查、本機 API／排程／AI 整合測試、前端邏輯與 API contract 測試，以及正式版建置。

瀏覽器驗證截圖存放在 `output/playwright/`。
