# GitHub Pages 架構

這個專案現在分成三層：

```text
Android APK ─┐
             ├─ 載入 GitHub Pages 前端（Vite dist）
瀏覽器      ─┘             │
                           └─ VITE_API_BASE_URL → 獨立的 Node/SQLite/Hermes API
```

## GitHub Pages 可以做什麼

GitHub Pages 只提供靜態前端檔案，不能執行目前的 `server/app.mjs`、SQLite 進度資料庫或 Hermes gateway。因此 Pages 必須把 `VITE_API_BASE_URL` 設成一個手機可以連線的 HTTPS API 位址。API 主機可以是家中電腦加上安全的 tunnel、VPS 或其他後端服務；API key 與 Hermes 設定必須留在 API 主機的 `.env`，不會進入瀏覽器或 APK。

## 啟用步驟

1. 在 GitHub repository 的 Settings → Pages，將 Source 設為 **GitHub Actions**。
2. 在 Settings → Secrets and variables → Actions → Variables 新增：
   - `VITE_API_BASE_URL`: 例如 `https://vocab-api.example.com`
   - `VITE_BASE_PATH`: 專案 Pages 使用 `/english-vocabulary-desk/`；若有 custom domain 則填 `/`
3. 推送到 `main`，`.github/workflows/deploy-pages.yml` 會執行 `npm ci`、`npm run build`，再發布 `dist/`。
4. API 必須允許 Pages origin 的 CORS，例如 `https://a131805956-ctrl.github.io`，並且以 HTTPS 對外提供 `/api/*`。後端可用 `CORS_ORIGIN=https://a131805956-ctrl.github.io` 收緊來源；未設定時為 `*`。

預設專案網站位址：

`https://a131805956-ctrl.github.io/english-vocabulary-desk/`

目前 repository 是 private，且 Pages 尚未啟用。請確認 GitHub 帳號方案允許 private repository 的 Pages；若不允許，需把 repository 改為 public，或改用其他靜態網站主機。

## 本機模式

不設定 `VITE_API_BASE_URL` 時，瀏覽器仍使用 Vite 的 `/api` proxy，對應本機 `127.0.0.1:4174`。因此 GitHub Pages 的設定不會破壞目前的桌面開發流程。

## 更新會不會自動到手機

- React/CSS/單字範圍等網頁內容：推送到 `main` 並完成 Pages workflow 後，使用遠端網站的 APK 重新開啟即可拿到新版本，不用重包 APK。
- Capacitor 原生程式、Android 權限或 app icon：仍要重新建置 APK。
- API、SQLite 或 Hermes bridge：要在 API 主機重新部署／重啟；GitHub Pages 不會更新它們。
