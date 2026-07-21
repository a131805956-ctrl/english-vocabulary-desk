# Hermes API 編輯頁操作

API 編輯頁修改的是「單字 API 伺服器目前記憶體中的 Hermes 設定」，不是 GitHub Pages
檔案，也不會把 API Key 寫進 GitHub 或 APK。伺服器重啟後，會重新讀取啟動時的環境變數。

## 開啟與解鎖

1. 開啟單字網站，按底部的「設定」。
2. 「文章生成器」選 **Hermes Agent**。
3. 在「API 編輯頁」輸入編輯密碼，再按「解鎖 API 編輯頁」。

密碼取決於 API 伺服器的啟動方式：

- 使用 `scripts/start-public-api.ps1` 且沒有自行設定密碼：`vocab-local-8642`
- 直接執行 `npm start` 且沒有設定密碼：`morpheme-local`
- 若啟動前設定了 `$env:API_EDIT_PASSWORD`：以你設定的值為準

## 欄位怎麼填

| 欄位 | 與目前 Hermes 相同的填法 | 說明 |
| --- | --- | --- |
| Hermes API 位址 | `http://127.0.0.1:8642/v1` | 這是「API 伺服器所在電腦」連 Hermes 的位址；不是手機的 `127.0.0.1`。 |
| 模型名稱 | `hermes-agent` | 填 Hermes API Server 對外列出的 model name。 |
| Session Key | `agent:default:vocab-app:local:huang-yujie` | 可保留現值；它識別單字 App 的 Hermes session。 |
| API Key | Hermes `.env` 的 `API_SERVER_KEY` | 輸入新值才會更新；留白代表保留現有金鑰。 |

填好後按「保存 Hermes API 設定」。成功訊息會說金鑰只留在單字伺服器記憶體；API Key
欄位重新顯示時只會顯示遮罩。若要清除金鑰，勾選「清除目前 API Key」後保存。

## 從手機編輯時的重點

手機開啟的是 GitHub Pages，但 `/api/settings` 會送到已設定的遠端單字 API。只要該 API
可從手機連線且 CORS 允許 Pages，便可以從手機解鎖與保存。欄位中的
`http://127.0.0.1:8642/v1` 仍然要保留，因為它是由電腦上的單字 API 連到同一台電腦的
Hermes；不要改成手機的 `127.0.0.1`。

## 讓設定在重啟後保留

編輯頁是 runtime 設定，重啟 API 後會重置。要永久保留，請在 API 主機啟動前設定環境
變數，並讓金鑰只存在該主機的 `.env` 或受保護的啟動腳本：

```powershell
$env:API_EDIT_PASSWORD = '請換成自己的長密碼'
$env:HERMES_API_URL = 'http://127.0.0.1:8642/v1'
$env:HERMES_API_MODEL = 'hermes-agent'
$env:HERMES_SESSION_KEY = 'agent:default:vocab-app:local:huang-yujie'
$env:HERMES_API_KEY = '不要提交到 Git 的 API_SERVER_KEY'
npm start
```

不要把 `$env:HERMES_API_KEY`、Hermes `.env` 或編輯密碼提交到 repository。
