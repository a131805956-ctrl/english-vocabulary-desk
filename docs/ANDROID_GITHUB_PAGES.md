# Android 連線到 GitHub Pages

遠端網站 APK 的建置需要同時指定：

- `VITE_API_BASE_URL`: 手機可連線的後端 API（不要填 `127.0.0.1`）
- `CAP_SERVER_URL`: GitHub Pages 網站，例如 `https://a131805956-ctrl.github.io/english-vocabulary-desk/`

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

若要做完全離線／內網 APK，清除 `CAP_SERVER_URL` 後執行 `npm run android:build`，Capacitor 會改用打包在 APK 裡的 `dist/`。
