# Android 遠端網站與 API 連線

目前這個專案的手機 APK 應連到 Tailscale Funnel 的 `/eng-vocabulary/`，因為
GitHub Pages 只提供靜態前端，不能執行本機的 Node／SQLite／Hermes API。若 APK
仍載入 GitHub Pages，範圍、複習紀錄與文章 API 會打到不存在的 `/api`，畫面就會
顯示沒有單字範圍。

## 目前手機版（建議）

在電腦上保持 vocabulary API 服務與 Funnel 執行，再建置 APK：

```powershell
cd C:\Users\10931\Desktop\英文單字\vocab-app
$env:VITE_BASE_PATH='/eng-vocabulary/'
$env:CAP_SERVER_URL='https://desktop-loi23mp.tail9c076e.ts.net/eng-vocabulary/'
npm run android:build
```

APK 會直接載入 Funnel 的同源前端與 API；不要把 Hermes API key 放在
`VITE_*` 變數，金鑰只能留在 API 主機的 `.env`。

## 其他遠端 API 架構

遠端網站 APK 的建置需要同時指定：

- `VITE_API_BASE_URL`: 手機可連線的後端 API（不要填 `127.0.0.1`）
- `CAP_SERVER_URL`: 手機可連線的網站，例如 `https://a131805956-ctrl.github.io/english-vocabulary-desk/`

PowerShell 範例：

```powershell
cd C:\Users\10931\Desktop\英文單字\vocab-app
$env:VITE_API_BASE_URL='https://vocab-api.example.com'
$env:CAP_SERVER_URL='https://a131805956-ctrl.github.io/english-vocabulary-desk/'
npm run build
npx cap sync android
cd android
gradlew.bat assembleDebug
```

APK 會載入 Pages 的前端，前端再呼叫 `VITE_API_BASE_URL`。不要把 Hermes API key 放在 `VITE_*` 變數；它只能由 API 主機讀取。

這個替代架構只有在 `VITE_API_BASE_URL` 指向可從手機連線、且已部署 `/api`
路由的 HTTPS 後端時才可用；目前的 GitHub Pages 網址本身沒有這些路由。

若要做完全離線／內網 APK，清除 `CAP_SERVER_URL` 後執行 `npm run android:build`，Capacitor 會改用打包在 APK 裡的 `dist/`。
