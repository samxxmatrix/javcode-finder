# JavCode Finder browser extension design

> Status: active · Scope: JavCode Finder product behavior, architecture, data flow, privacy, compatibility, and delivery

本文档定义 JavCode Finder 的产品与工程边界。

## 1. Product objective

用户主动点击浏览器工具栏图标后，extension 识别当前激活页面可见内容里的影片番号，并围绕番号提供三项能力：

1. **预览**：点击番号，侧边栏内展示封面图，并可点击播放预告片。数据来源：DMM API（开关开启时优先，mp4 直链）或 javtrailers.com（默认/兜底，HLS）。
2. **定位**：在当前页面中定位并高亮该番号出现的位置。
3. **跳转**：直达外部平台（JavDB / supjav 等，模板可配置）。

Extension 不提供榜单、评分、标记或账号体系，是纯粹的页面番号工具。

## 2. Core flows

### 扫描（Scan）

- 仅在用户主动触发后，通过 `browser.scripting.executeScript` 在 top-level document 注入自包含函数 `extractCandidatesInTab`。
- 提取规则：默认正则 `\b[A-Za-z][A-Za-z0-9]{2,5}[-—–\s]+\d{3,6}\b`（可在设置中自定义），2 MiB 扫描上限，最多 500 个去重候选。
- 候选过滤：拒绝 URL、协议前缀、常见域名后缀、文件扩展名等。
- 不支持页面：`chrome://`、`chrome-extension://`、`edge://`、`about:`、浏览器商店页、`addons.mozilla.org`。

### 番号 → 媒体解析（Media resolution）

预览媒体按设置开关双源解析：`jt:resolve-detail` 消息随番号携带 DMM 配置。

1. **DMM API（开关开启且地址/Key 齐全时优先）**：background 请求 `{base}/{code}?key=`（自建 Vercel 东京部署，见 dmm-api接口文档.txt；5 秒超时）。命中返回 cid、长文标题、封面大图、预告片 mp4 直链；404 或异常静默回退 javtrailers。
2. **javtrailers（默认/兜底）**：搜索页解析 Content ID（番号→Content ID 不可靠推导，如 `DLDSS-529` → `1dldss00529`，必须走搜索页解析）：
   - background fetch `https://javtrailers.com/search/{code}`（扩展持有 `*://*/*` host permissions，不受 CORS 限制；5 秒超时）。
   - `parseSearchPageHtml` 解析第一张 `card-container`：提取 `href="/video/{contentId}"` 与 `img` 的 `alt`（形如 `DLDSS-529 jav`），以 comparison key 比对确认精确匹配。
   - 解析锚点必须为 `class="card-container"`：页面 `<style>` 中的 `.card-container` CSS 规则先于卡片出现（真实页面踩坑，见测试）。

### 封面与预告片（Preview）

- DMM 源：封面为 DMM 大图（jpg），预告片为 mp4 直链（`video.src` 直接播放，无需 hls.js 与 CORS 处理，Firefox 也可播）。
- javtrailers 源：封面 `https://images.javtrailers.com/digital/video/{code}/{code}pl.w800.webp`；预告片 HLS `https://media.javtrailers.com/hlsvideo/freepv/{c0}/{c0-2}/{code}/playlist.m3u8`。
- javtrailers 播放：hls.js 按需动态 import；Chromium 上由 background 注册 DNR 动态规则（id 9001）给 `media.javtrailers.com` 响应注入 `Access-Control-Allow-Origin: *`（该 CDN 无 CORS 头）。Firefox 的 DNR 不支持修改响应头，播放失败时 UI 降级为"在 JavTrailers 打开"。
- 404 / 加载失败分别显示"该番号暂无预告片" / "预告片加载失败"。

### 页面定位（Locate）

- 通过 `browser.scripting.executeScript` 注入 `locateCodeInTab`：TreeWalker 遍历可见文本节点，正则匹配（支持 FC2 变体），`<mark>` 包裹 + 金色脉冲高亮动画，2.6 秒后自动淡出还原。
- 同一番号多处出现时，重复点击循环定位（状态存于页面 `window.__javranking_locate_state`）。

## 3. Settings

- 存储于 `localStorage`（`javranking_search_settings`、`javranking_user_locale`），永不过期，读取失败降级默认值。
- 可配置项：JavTrailers 跳转模板（默认 `https://javtrailers.com/search/{code}`）、JavDB 跳转模板（默认 `https://javdb.com/search?q={code}`）、DMM 查询 API（地址 + Key + 开关，打开时验证）、排除站点黑名单、番号识别正则、界面语言（简中/繁中/英）。
- 模板占位符：`{code}`、`{番号}`、`{ID}`；无占位符时按 URL 形态智能追加。
- 旧版本 `missavTemplate` 字段迁移：自定义值保留，等于旧默认值时改用 JavTrailers 默认。

## 4. Manifest & permissions

- `activeTab` / `scripting`：注入扫描与定位函数。
- `sidePanel` / `tabs`：侧边栏生命周期与标签页查询。
- `declarativeNetRequest` + `declarativeNetRequestWithHostAccess`：HLS CORS 注入。
- `host_permissions: ["*://*/*"]`：scripting 注入 + DNR + background 跨域 fetch。

## 5. Privacy

- 无持久 content script，无后台定时扫描，无按键监听。
- 不读取浏览历史、其他标签页、cookies、表单、剪贴板。
- 不向任何服务器上传页面 URL、页面文字、DOM 内容、番号候选或浏览活动。
- 网络请求仅三类：用户点击后按需加载的预览媒体（DMM API 查询或 javtrailers 封面/预告片）、搜索页解析请求（不含任何页面或用户数据）、打开扩展 UI 时的 GitHub Release 版本检查。

## 6. Testing & delivery

- 单元测试覆盖全部 lib 模块（vitest）：番号提取/规范化、javtrailers URL 构造与搜索页解析、设置与迁移、版本比较。
- 构建与打包：`npm run build` + `npm run zip`，产物输出 `.output/`。
- Chrome/Edge 为 primary targets；Firefox feature-compatible（预告片播放降级为跳转）。
