# JavCode Finder 瀏覽器擴充功能

[简体中文](README.md) · [English](README.en.md)

JavCode Finder 會在你主動點擊瀏覽器工具列圖示後，識別當前頁面中的影片番號，並在側邊欄裡圍繞番號提供：

- **番號識別**：一次掃出當前頁面出現的全部番號並去重。支援有碼號（`IPX-118`、`DLDSS-529`）、無碼號與 `FC2-*` 各種寫法。識別正則與**番號排除黑名單**都可在設定裡改
- **封面與預告片預覽**：點擊番號即依需求載入封面、標題與介紹、出演者、發行日，可內嵌播放預告片
- **標題與出演者翻譯**：簡中／繁中／英文介面自動把日文標題與出演者譯成對應語言。預設走 Google／微軟公開翻譯介面，備用服務可在設定中切換；也可接任意 OpenAI 相容的 AI 服務來翻譯
- **頁面定位**：一鍵在當前網頁中定位並凸顯該番號；同一番號多處出現時可重複點擊循環定位
- **番號收藏**：以書籤方式收藏看中的番號，預設只保存在本機，可在設定裡開啟雲端同步
- **雲端同步**：開啟後把收藏番號與設定資料同步至雲端（你自己的 WebDAV 空間），多台裝置共用同一份
- **Emby 媒體庫聯動**：填入 Emby 位址與 API Key 後，面板會給已在庫的作品打上標識
- **快捷跳轉**：三個可自訂的外部平台按鈕（名稱 + 連結範本），依番號直達搜尋頁；範本裡需要寫佔位符（`{code}` 或 `{番号}`）。例如連結規則填 `https://javdb.com/search?q={code}`，點擊番號 `ABP-123` 時實際跳轉 `https://javdb.com/search?q=ABP-123`
- **其他**：簡中／繁中／英文三語介面、預覽音量可調、最多每 24 小時檢查一次新版本並在面板提示

> 有碼號不接後端時走平台直連，資料有限；接入可選後端 `javcode-api` 後，DMM／FALENO／無碼號的標題、介紹、封面與預告片才完整。資產直連通常仍需瀏覽器能存取日本源站——詳見下文「可選後端」。

## 安裝 Chrome 或 Edge 版本

1. 從 [GitHub Releases](https://github.com/samxxmatrix/javcode-finder/releases) 下載 Chromium ZIP。
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

## 可選後端（進階）

擴充功能**不需要任何後端就能用**：番號識別、標註、媒體庫聯動、設定同步、頁面預覽都在擴充功能內部完成。番號資料可以接自架後端來增強，依需求部署即可：

| 後端 | 提供什麼 | 不部署時 |
|---|---|---|
| [`javcode-api`](advanced/javcode-api/) | DMM／FALENO／無碼號的識別，影片標題、介紹，封面、預告片直連與快取 | 有碼號改走平台直連，資料有限；無碼號無法識別與標註，沒有封面與預告片 |

**接入 `javcode-api`**：部署後在「設定 → 進階設定 → 資料來源 → 番號查詢」填入服務位址與 API Key，開啟開關即生效。開關會先請求 `GET /health`，同時驗證服務可達與 Key 正確 —— 鑑權失敗、服務不可達會就地在行內提示，不會靜默失敗。介面參數與回應欄位見 [`介面文件`](advanced/javcode-api/接口文档.md)。

`advanced/` 下另有 `adaptive-proxy.js`（可選入口層，給 `*.vercel.app` 套一層自有網域），完整清單參見 [`advanced/README.md`](advanced/README.md)。

> 翻譯不需要專用後端。設定裡的「翻譯 API 位址／Key／模型」用於接入任意 **OpenAI 相容**服務（自架代理、OpenAI 官方或本地模型皆可）：填 Base URL（如 `https://api.openai.com` 或自架位址）與 API Key，模型可從 `/v1/models` 拉取下拉選擇，也能手動輸入。開啟開關時會先請求 `GET /v1/models` 驗證服務與 Key；翻譯走 `POST /v1/chat/completions`，翻譯提示詞由擴充功能自動附上。AI 模式沒有字元配額，介面不顯示用量。原 DeepL 翻譯 Worker（`deepl-translate-api`）已歸檔停更，其私有 `/translate`、`/usage` 介面不再相容。

注意：部署意味著以你自己的帳號去抓取公開網頁，合規與平台條款請自行確認。後端回傳的封面與預告片是**源站直連**，因此「查詢成功」不等於「圖片能顯示」——用戶端所在網路存取不了日本源站時仍會破圖，這與查詢介面無關。

## 隱私

擴充功能只會在使用者主動觸發後讀取當前頂層頁面。它不會傳送或保存頁面 URL、頁面文字、DOM 內容、番號候選或瀏覽活動。

封面與預告片資料僅在使用者點擊某個番號後依需求載入。擴充功能背景（background）只帶著這一個番號，向少量第三方公開頁面與公開介面發起查詢；若使用者在設定中填入自架後端位址，則改為向該後端查詢——後端由使用者自行部署與維護。必要時會與另一個公開來源並行查詢、依欄位合併結果。任何一次請求都只包含被點擊的那個番號，不包含頁面 URL、頁面文字、DOM 內容或番號候選。

## 授權

[MIT](LICENSE)
