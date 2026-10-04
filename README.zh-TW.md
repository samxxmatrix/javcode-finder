# JavCode Finder 瀏覽器擴充功能

[简体中文](README.md) · [English](README.en.md)

JavCode Finder 會在你主動點擊瀏覽器工具列圖示後，識別當前頁面中的影片番號，並提供：

- **封面與預告片預覽**：點擊番號，在側邊欄內查看來自 JavTrailers 的封面，並可點擊播放預告片（HLS）
- **頁面定位**：一鍵在當前網頁中定位並凸顯該番號出現的位置
- **快捷跳轉**：直達 JavTrailers 詳情頁（透過搜尋頁精確匹配 Content ID），或在 JavDB 中查看詳情
- **自訂規則**：可自訂番號識別正則、外部跳轉範本與排除站點

## 安裝 Chrome 或 Edge 版本

1. 從 [GitHub Releases](https://github.com/aizhimou/javranking-extension/releases) 下載 Chromium ZIP。
2. 將 ZIP 解壓到會保留的本機資料夾。
3. 開啟 `chrome://extensions` 或 `edge://extensions`。
4. 開啟 **Developer mode**，選擇 **Load unpacked**，再選擇包含 `manifest.json` 的解壓資料夾。

Unpacked extension 的更新需要手動完成：下載並解壓新版後，在擴充功能卡片選擇 **Reload**。擴充功能最多每 24 小時檢查一次 GitHub 上的最新版本，發現更高版本時會在側邊欄頂部給出下載入口（同一版本關閉後不再提示）。

Firefox 可用於 temporary development load；持久安裝仍需要 Mozilla 簽名的 XPI，目前尚未提供。

## 從原始碼驗證與建置

需要 Node.js 20.19 或更高版本。

```sh
npm ci
npm run compile
npm test
npm run build
npm run zip
```

production ZIP 會輸出到 `.output/`。建置產物不會提交到 Git。

發版用 `npm run release <patch|minor|major|x.y.z>`：自動改版本號（唯一來源是 `package.json`）、追加 `CHANGELOG.md`、打包並校驗產物版本、打 `v<版本>` tag，並產生 Release 資產 `.output/version.json`（擴充功能的更新提示就是讀它）。加 `--dry-run` 只看計畫、`--push` 才推送。

## 隱私

擴充功能只會在使用者主動觸發後讀取當前頂層頁面。它不會傳送或保存頁面 URL、頁面文字、DOM 內容、番號候選或瀏覽活動。

封面與預告片資料僅在使用者點擊番號後依需求從 javtrailers.com 載入；跳轉解析透過 background 請求 javtrailers 搜尋頁完成，不包含任何頁面或使用者資料。

## 授權

[MIT](LICENSE)
