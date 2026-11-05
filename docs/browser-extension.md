# JavCode Finder browser extension design

> Status: active · Scope: JavCode Finder product behavior, architecture, data flow, privacy, compatibility, and delivery

本文档定义 JavCode Finder 的产品与工程边界。

## 1. Product objective

用户主动点击浏览器工具栏图标后，extension 识别当前激活页面可见内容里的影片番号，并围绕番号提供三项能力：

1. **预览**：点击番号，侧边栏内展示封面图，并可点击播放预告片。数据来源：封面与预告片优先 javtrailers.com（全球可达，HLS / mp4），标题与介绍优先 DMM API 或 FALENO（两者并发后按字段合并，见「番号 → 媒体解析」）。
2. **定位**：在当前页面中定位并高亮该番号出现的位置。
3. **跳转**：直达外部平台（JavDB / supjav 等，模板可配置）。

Extension 不提供榜单、评分、标记或账号体系，是纯粹的页面番号工具。

## 2. Core flows

### 扫描（Scan）

- 仅在用户主动触发后，通过 `browser.scripting.executeScript` 在 top-level document 注入自包含函数 `extractCandidatesInTab`。
- 提取规则：默认正则见 `src/lib/settings.ts` 的 `DEFAULT_CODE_REGEX`（含 `FC2-<数字>`、`FC2-PPV-<数字>`、`FC2PPV<数字>` 三种 FC2 变体，可在设置中自定义），2 MiB 扫描上限，最多 500 个去重候选。
- **安全模式**：整页文本超 2 MiB 或候选撞 500 上限时进入，面板顶部显示横幅「页面内容超过扫描上限，进入安全模式，可手动扫描，关闭恢复。」并抑制自动整页扫描（仅用户点扫描按钮时触发）。安全模式下扫描目标改为**视口内可见文本**（`getViewportText`：递归剪掉视口外子树、跳过隐藏元素），避免大页整页全扫。关闭横幅 = 退出并强制跑一次完整页扫描（仍超大则再次进入、横幅弹回）。
- 候选过滤：拒绝 URL、协议前缀、常见域名后缀、文件扩展名等。
- 不支持页面：`chrome://`、`chrome-extension://`、`edge://`、`about:`、浏览器商店页、`addons.mozilla.org`。

### 番号规范化（Code normalization）

面板内部统一使用"显示码"：`normalizeCode()`（[`src/lib/normalize-code.ts`](../src/lib/normalize-code.ts)）= NFKC → trim → 大写 → 折叠空白与破折号变体（`—` / `–`）为 `-`。

- **`-` 与 `_` 是两个不同的分隔符，必须保留**：它们编码**不同片商**——实测（2026-10-08）`100826_001` → 1pondo（一本道）、`100826-001` → caribbeancom（カリビアンコム），是**两部不同作品**。折叠分隔符会让面板列表去重后只剩一条，另一部**永远查不到**（用户报的症状即此）。
- 需要"写法无关"的匹配时才用 `toComparisonKey()`，它**故意剥离**所有分隔符（`-`/`_`/空白/破折号）：只用于 Emby 在库判定与 javtrailers 卡片比对。**不得**用它的结果当显示码、收藏键或查询码。
- FC2 类的 `PPV` 段在两处都压平为 `FC2-<数字>`（见下节外部跳转）。

### 番号 → 媒体解析（Media resolution）

预览媒体按多源解析：D2PASS（无码号，链首命中即胜、不参与合并）→ **JavTrailers ∥ 第二路 → 字段级合并**；FC2 号独占 FC2 源，见下。`jt:resolve-detail` 消息随番号携带 DMM 配置与 FALENO 前缀。

**为什么并发 + 合并，而不是"先命中即胜"**：封面/预览与标题的最优来源不是同一个——封面按**资产可达性**取（JavTrailers 的 `images/media.javtrailers.com`、FALENO 的 `cdn.faleno.net` 都全球可达；DMM 的 `pics.dmm.co.jp` / `cc3001.dmm.co.jp` 需日本出口），标题按**数据完整度**取（DMM 商品名最全，其次 FALENO）。旧实现是"某源命中就整条返回"，DMM 一命中 JavTrailers/FALENO 根本不执行，字段级优先级形同虚设。

| 字段组 | 提供方优先级 |
| --- | --- |
| `source` / `contentId` / `previewType` / `coverUrl` / `previewUrl` | JavTrailers > FALENO > DMM |
| `detailUrl` / `title` / `shortTitle` / `performers` / `releaseDate` | DMM > FALENO > JavTrailers |

合并后 `source` 取**封面方**，因此 UI 的 mp4/HLS 分支、封面兜底、DNR CORS 注入都随它自然正确。

第二路按番号类型二选一，并发形态：

| 场景 | 并发 | 备注 |
| --- | --- | --- |
| 反代启用 + FNS 号 | `JT ∥ {base}/faleno/{code}` | 常态 1 次反代调用、1 次上游 |
| 反代启用 + 非 FNS 号 | `JT ∥ {base}/{code}` | 与旧实现等成本 |
| 反代未启用 + FNS 号 | `JT ∥ 直连 faleno.jp` | 大陆宽带必 403（见「封面与预告片」） |
| 反代未启用 + 非 FNS 号 | 仅 JT | DMM 需反代、FALENO 前缀不命中 |

1. **javtrailers（封面方默认，全球可达）**：搜索页解析 Content ID（番号→Content ID 不可靠推导，如 `DLDSS-529` → `1dldss00529`，必须走搜索页解析）：
   - background fetch `https://javtrailers.com/search/{code}`（扩展持有 `*://*/*` host permissions，不受 CORS 限制；5 秒超时）。
   - `parseSearchPageHtml` 解析第一张 `card-container`：提取 `href="/video/{contentId}"` 与 `img` 的 `alt`（形如 `DLDSS-529 jav`），以 comparison key 比对确认精确匹配。
   - 解析锚点必须为 `class="card-container"`：页面 `<style>` 中的 `.card-container` CSS 规则先于卡片出现（真实页面踩坑，见测试）。

2. **DMM API（第二路；仅反代启用且番号非 FNS）**：background 请求 `{base}/{code}?key=`（自建 Vercel 东京部署，见 dmm-api接口文档.md；5 秒超时）。命中返回 cid、标题与介绍、封面大图、预告片 mp4 直链。它只贡献**标题与后备档**：封面仍优先 JavTrailers（DMM 图片要日本出口）。404 按未命中处理（JT 那一路照常在跑），其他错误保留来源、错误码/消息。**`dmmEnabled` 是"是否使用反代"的唯一权威开关**：开关关掉时，即便地址与 Key 还填着，DMM 不查、FALENO 也一律直连。

3. **FALENO（第二路；仅番号前缀命中，默认 `["FNS"]`）**：前缀不命中时**一次请求都不发**（第二路换成 DMM）。
   - 取名走哪条腿由 `dmmEnabled` 决定：开关打开且地址/Key 齐备 → `{base}/faleno/{code}?key=`（东京出口 + 永久缓存）；否则**直连** `https://faleno.jp/top/works/{code}/`。**不要**把两者解耦成"FALENO 只看地址与 Key"——关掉 DMM 源就等于放弃反代出口，这是预期行为。
   - 大陆宽带直连作品页**必 403**（XSERVER 拦大陆段，与 UA/尾斜杠无关；美国 / 东京出口 200），但拿到的资产在 `cdn.faleno.net`（CloudFront）**全球可达**且支持 Range。所以"配了反代"时 FALENO 完整可用，资产可达性还优于 DMM。
   - **串行补查**：FALENO 返回查无**或抛错**时，扩展再问一次 `{base}/{code}`（DMM）。这是"命中才付代价"的罕见分支，所以不做常态并发。补查同样受 `dmmEnabled` 约束。
   - **负缓存**：只在**确认查无**（404 / `ITEM_NOT_FOUND` / 作品页解析不到）时把该番号记进会话内存集合（上限 200、FIFO、不落 storage）；命中即 0 请求直接走 DMM。抛错**不记**——故障不代表站点没有该号。
   - 错误口径：整体 `resolved` 时**丢弃 faleno 错误**（大陆用户每次 FNS 号都会 403，否则 JT 封面/预览正常时也会常驻一条「查询失败：FALENO 403」）；**保留 dmm 错误**（「已使用备用来源」提示依赖它）。

4. **FC2（番号以 `FC2` 开头时独占此源，不回退其他源）**：番号即文章号，直接请求公开接口，无需 key / cookie / 会话。
   - background `GET https://adult.contents.fc2.com/api/v2/videos/{文章号}/sample` → `{path, poster_image_path, code}`。**"无此片"有两种实测信号**：HTTP 400 + `{"code":400}`，或 HTTP 200 + `{"path":501}`（数字哨兵值，不是 URL）——两者都必须归为"查无"，绝不把非 URL 交给 `<video>`。返回的 `path` 是带 `mid` 令牌的 mp4 直链，**令牌会失效（过期后 403），因此每次播放都重新解析，绝不缓存**。分片主机名（`vip-videoprem<NNNNN>.fc2.com`）随视频变化且不可构造，只能取接口返回值。
   - 标题与封面另有两个来源，都只需要文章号，因此与 `/sample` **并行发送**：
     - `GET /embed/{文章号}/` → `data-title`（标题）、`data-vid`（contentId）。公开接口不返回标题。
     - `GET /article/{文章号}/` → `og:image`（**正方形产品封面**，原图 1000×1000 / 1.1-1.6 MB）。该页未压缩 309 KB，浏览器 fetch 自动协商 gzip 后线上仅约 25 KB。
   - **封面优先级**：正方形产品封面经 `https://contents-thumbnail2.fc2.com/w276/<原路径>` 代理（w276 就是站点自己渲染这张图的宽度，实测 210 KB / 177 KB / 9.7 KB）；取不到（页面无 `og:image`、请求失败或超时、非 https）**退回** `/sample` 的 `poster_image_path` 经 `w480` 代理（横版视频帧）。两者都只改写 `storage*.contents.fc2.com` 域名，其他来源原样保留。
   - 超时：`/sample` 首次 8 s、失败重试一次 5 s（与反代查询同策略；**HTTP 400 不重试**，那是"无此片"的明确答案）；`/embed` 与 `/article/` 各单次 5 s，失败仅降级为无标题 / 退回横版封面，不影响播放。三个请求并行，最坏 13 s，典型约 0.6 s。
   - 命中即返回；未命中（HTTP 400 或响应校验不过）即"暂无番号信息"，不进入 DMM/JavTrailers/FALENO。
   - `previewType: "mp4"`，走 `<video src>` 直链分支：媒体元素忽略该主机的 `Content-Disposition: attachment`（该头只影响地址栏导航）；该 CDN 无 CORS 头，但 no-cors 的媒体请求不需要。

### 封面与预告片（Preview）

- DMM 源：封面为 DMM 大图（jpg），预告片为 mp4 直链（`video.src` 直接播放，无需 hls.js 与 CORS 处理，Firefox 也可播）。
- javtrailers 源：封面 `https://images.javtrailers.com/digital/video/{code}/{code}pl.w800.webp`；预告片 HLS `https://media.javtrailers.com/hlsvideo/freepv/{c0}/{c0-2}/{code}/playlist.m3u8`。
- FALENO 源：封面与预告片都在 `cdn.faleno.net`（CloudFront，全球可达、支持 Range），预告片为 `*_PR.mp4`，走 mp4 直链分支。
- 查询结果使用 `resolved`、`not_found`、`error` 状态，并保留解析媒体及来源错误。只有完成查询且无匹配时才显示“暂无此番号信息”；查询错误显示于媒体区底部，不伪装成无资料。
- 错误展示口径：DMM 错误即使其他源命中也会保留并显示，同时标注已使用备用来源；**FALENO 错误在整体 resolved 时被丢弃**（大陆宽带直连作品页必 403，否则 JT 正常时也会常驻一条查询失败）。接口错误展示来源、错误码及服务端消息；网络、超时和异常响应使用本地化错误详情。
- **运行时回退链**（封面与播放共用同一套档位规则，`preview-state.ts` 的 `nextFallbackStage`）：主媒体 → **JavTrailers 详情页兜底（mgstage，仅封面方是 javtrailers 时）** → `media.fallbackTiers` 逐档 → 失败。
  - `fallbackTiers` 在**解析期**就已按可达性排好（`[faleno]` 或 `[dmm]`），回退时只换 `src`、**不再发任何查询**；封面方自身不入后备档，所以"JT 查无、封面来自第二路"时没有后备档。
  - 因为 `image.mgstage.com` / `sample.mgstage.com` 全球可达，第二档对大陆用户也可用；DMM 那一档是唯一可能整层失效的（需日本 IP），作为最后兜底。
  - 每档都要等到失败信号才推进下一档，同一档的 `onError` 与 `play()` rejection 会去重（否则一次失败会跳两档）。
- javtrailers 播放：hls.js 按需动态 import；Chromium 上由 background 注册 DNR 动态规则（id 9001）给 `media.javtrailers.com` 响应注入 `Access-Control-Allow-Origin: *`（该 CDN 无 CORS 头）。Firefox 的 DNR 不支持修改响应头，可能遇到播放失败；HLS 致命错误（404 / CORS）一律进入上面的回退链。
- 有封面但无预告片地址时保留封面、不显示播放按钮，并在媒体底部显示“暂无预告片”。已解析到预告片但**播放失败**时，媒体主体显示「**xxx 源播放失败**」（`playbackFailedBySource`，简繁英三语），来源标签**只在这一条件下出现**（常态不显示来源），底部通知提供仅重试播放的操作；查询错误可独立重试完整解析。底部通知为单行、省略号截断且可关闭，关闭后可通过番号标题重新解析。来源取"实际在播的那一档"（主媒体 → 详情页兜底仍记 JavTrailers → 后备档记该档的来源）。

### 外部跳转（External jump）

- 三个跳转按钮（Supjav / JavDB / 自定义）用模板 + 番号拼 URL，番号取自面板显示码（`normalizeCode()` 的输出）。
- FC2 类番号例外：外部站点只认 `FC2-PPV-<数字>` 写法，而显示码把 PPV 段压平为 `FC2-<数字>`，因此跳转前由 `toExternalSearchCode()`（`src/lib/normalize-code.ts`）补回 PPV。面板显示、收藏、Emby 在库判定、页面定位与预览查询一律继续使用显示码。
- 例：页面 `FC2-PPV-123456` → 面板显示 `FC2-123456` → JavDB 跳转 `https://javdb.com/search?q=FC2-PPV-123456`。

### 页面定位（Locate）

- 通过 `browser.scripting.executeScript` 注入 `locateCodeInTab`：TreeWalker 遍历可见文本节点，正则匹配（支持 FC2 变体），`<mark>` 包裹 + 金色脉冲高亮动画，2.6 秒后自动淡出还原。
- 同一番号多处出现时，重复点击循环定位（状态存于页面 `window.__javranking_locate_state`）。

### 有码 / 无码自动识别（内部选源，不做 UI 标记）

**面板不加徽章。** 识别结果只在内部决定"走哪个预览源"和回退顺序，用户既不需要看到，也不需要手动切换。

#### 为什么不按页面域名分档

番号可能出现在任何页面——论坛帖、网盘目录、聊天记录、资源站列表——**页面域名与番号形态没有因果关系**；反过来在 dmm.co.jp 上也照样有人贴无码番号。所以匹配规则**只看番号自身的强度 + 页面里的锚点**，与 host 无关。

#### 两层匹配

**T1 强特征（任何页面默认开，零上下文）**

| 规则 | 覆盖 |
| ---- | ---- |
| `(?<![\d._])(?:0[1-9]\|1[0-2])(?:0[1-9]\|[12]\d\|3[01])\d{2}[-_]\d{2,4}(?![\d])` | 日期型：`100426-001`、`100426_01`、`100326_001`、`100126_100`、`100426_1267`、`100526_001` |
| `(?<![A-Z0-9])HEYZO[-_ ]?\d{3,5}(?![\d])` | `HEYZO-3953` |
| `(?<![A-Z0-9])3dw[-_]\d{3,4}(?![\d])` | `3dw-315`（旧正则漏，因数字开头） |
| `(?<![A-Z0-9])hitozuma\d{3,5}(?![\d])` | `hitozuma1579`（旧正则漏，因无分隔符） |
| `(?<![A-Za-z0-9._])0\d{4}(?![\d])` | 零填充 5 位：`04684`（ピッカー） |
| 既有的 `[A-Z][A-Z0-9]{1,5}[-\u2026]+\d{3,6}` 与 FC2 三变体 | 有码番号、`FC2-*` |

日期型的合法月日校验（01–12 / 01–31）与位数下限是主要防线；**前边界断言族**（日期型的 `(?<![\d._])`、零填充型的 `(?<![A-Za-z0-9._])`、T2 数字型的 `(?<![\d._/-])`）挡掉"嵌在更长数字串里"的形态：`20240115-001` / `ORDER-20240115-0001` 是被零填充前边界（前面是数字）与 T2 数字型前断言挡下的——日期型本身根本匹配不到它们（月日校验不过）；`user_id=395312` 这种 6 位裸数字没有任何规则覆盖（位数与分隔符都不符）。零填充型额外排除字母与 `.`/`_`，挡掉 `DSC04684`、`IMG_04684.jpg`、`No.00001`。逐条映射（哪个写法撞在哪条断言上）见 `test/uncensored-code.test.ts` 的 `NOISE_CORPUS` 表（`[输入, 期望, 守住的断言]`）。

**T2 弱特征（全页出现无码锚点才启用）**

| 规则 | 覆盖 | 备注 |
| ---- | ---- | ---- |
| `(?<![A-Z0-9])(?:ori\|gol)\d{4,5}(?![\d])` / `(?<![A-Z0-9])les\d{3,4}(?![\d])` / `(?<![A-Z0-9])n\d{4,5}(?![\d])` | `ori1812`、`n3351` | 边界断言为**加固**：无前断言会把 `on3351` 里的 `n3351` 抓出来；无尾断言会把 6 位尾巴的 `n335123` 截成 `n33512`、`ori181234` 截成 `ori18123`（实测均为误报） |
| `(?<![\d._/-])\d{3,5}[-/]\d{2,4}(?![\d])(?![-/]\d)` | `4229-2960`（Hey動画）、`4422/032`（av9898） | 两侧否定断言挡掉 `2024-01-15`、`090-1234-5678`；前向断言里的 `/` 挡掉 URL 路径片段（`.../video/12345/678.html`、`watch/movie/4422/032/index.html`、`/gallery/1234/567`）——**前一个字符是空格时 `4422/032` 照样命中** |
| `(?<![\d._/-])\d{2,4}[-_]\d{3,4}(?![\d])(?![-/]\d)` | `103_933`（エロックス） | 前向断言同样带 `/`：两条数字型规则用同一套边界，不给未来留两套口径 |

**锚点表**（与 host 无关，页面文本命中任意一条即启用 T2）：18 家站名与域名 + `無修正` / `無碼` / `无码` / `uncensored`。

**两条去重规则**：① 长匹配优先——被更长匹配包含的短匹配丢弃（可达形态只有一种：`04684-4229` 命中后丢掉其中的 `04684`——**没有任何规则匹配裸 4 位数字**，所以"`4229-2960` 丢掉 `4229`/`2960`"那种写法不可达；实现是"按规则分桶 + 二分查找"，等价于两两比对，因为这段跑在**被注入页面的主线程**上，O(n²) 在 2 MiB 页面上会卡死页面）；② 锚点自带数字排除（`エッチな0930`→`0930`、`h4610`→`4610`、`av9898`→`9898` 不当番号）。

#### 实测

| 场景 | 结果 |
| ---- | ---- |
| 裸番号（页面无任何锚点） | **10/11 命中**（T1 独力覆盖日期型、HEYZO、3dw、hitozuma、零填充） |
| 带锚点的弱形态 | `ori1812`、`4229-2960`、`103_933`、`n3351` **4/4 命中** |
| 噪音 28 条（ISO 日期 / 电话 / 版本号 / 文件名 / 订单号 / 价格 / 时间 / 序号，含"带锚点"变体） | **0 误报** |
| URL 路径片段 3 条（`https://site.com/video/12345/678.html`、`watch/movie/4422/032/index.html`、`/gallery/1234/567`） | **0 误报**（前向断言加 `/` 之前分别误报 `12345/678`、`4422/032`、`1234/567`） |
| 有码 / 素人番号 | 不被无码规则误吞，仍由既有规则处理 |

> **知情接受的两条残留**（文本上与真实番号/写法不可区分，再收紧就变成漏报）：
> `img/04684/01` → `04684`（`04684` 是 T1 零填充命中，与合法的 pikkur 链接 `www.pikkur.com/moviepages/04684/index.html` 文本相同）；
> `ID:12345/678` → `12345/678`（前一字符是 `:`，把 `:` 加进前向断言会漏掉 `av9898:4422/032`、`番号:4422/032`）。
> 代价只是多一条候选行走一次"查无"，**漏报比多一条可忽略候选行更糟**。

> 对比：改动前的 `DEFAULT_CODE_REGEX` 在无锚点页面上只能抽出 `HEYZO-3953`，17 种无码形态漏 16 种。

**能力边界（明确不做）**：纯 4 位裸数字——`3953`（HEYZO）、`3997`（金髪天國）——**不做自动抽取**，因为 `第1234回`、`IMG_3953.jpg` 这类噪音与它无法区分。要查这类号，页面上得写成 `HEYZO-3953`；后续可加"手动输入番号"入口补上。

#### 识别结果的用途（内部）

| 用途 | 规则 |
| ---- | ---- |
| 选源 | 无码形态 → **优先 D2Pass 源**；有码形态 → `JT ∥ 第二路`（FNS 号 → FALENO，其余 → DMM）后字段级合并；`FC2-*` → 独占 FC2 源 |
| 回退 | 判错代价很小：JT 与反代/直连的"查无"都在 0.5–3 s 内返回；解析期已确定的第二路顺手成为免费后备档，**不需要用户手动切换** |
| 覆盖 | 无码源（D2PASS）命中即整条返回，形态猜测不再生效；有码侧的 `source` 是**封面方**（通常是 JavTrailers），**不代表"谁确认了番号"** |

#### 集成点

- `ExtractionResult` 保持 `candidates: string[]` 不变：T2 判定与两条去重规则都在注入的抽取函数内部完成，不改变消息契约。
- `locateCodeInTab`（页面定位）需同步这套规则，否则会出现"列表里有、页面上定位不到"。
- `src/lib/preview-source.ts` 新增 `d2pass` 源时必须登记：`isDirectMp4Source()` 要包含它（无码预告片实测 `206 video/mp4`、无防盗链、无需 CORS，走的正是 `<video src>` 直链分支）。该文件的历史教训：漏登记会静默走错分支。

## 3. Settings

- 存储于 `localStorage`（`javranking_search_settings`、`javranking_user_locale`），永不过期，读取失败降级默认值。
- 可配置项：JavTrailers 跳转模板（默认 `https://javtrailers.com/search/{code}`）、JavDB 跳转模板（默认 `https://javdb.com/search?q={code}`）、DMM 查询 API（地址 + Key + 开关，打开时仅校验地址与 Key 非空，不调接口验证）、排除站点黑名单、番号识别正则、界面语言（简中/繁中/英）。
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
- 网络请求仅四类，全部在用户主动触发后发起：预览媒体与详情（自建后端的 DMM / FALENO 查询、javtrailers 搜索页与详情页解析、FALENO 官网直连、FC2 公开接口、FALENO/DMM 资产 CDN）、FC2 内嵌页标题读取（`adult.contents.fc2.com/embed/`）、跳转解析（javtrailers 搜索页）、打开扩展 UI 时的 GitHub Release 版本检查。以上均不含页面 URL、页面文字、DOM 内容、番号候选或浏览活动。

## 6. Testing & delivery

- 单元测试覆盖全部 lib 模块（vitest）：番号提取/规范化、javtrailers URL 构造与搜索页解析、多源字段级合并与串行补查（`resolve-preview`）、回退档位规则（`nextFallbackStage`）、FALENO 负缓存（`faleno-miss`）、设置与迁移、版本比较。
- 构建与打包：`npm run build` + `npm run zip`，产物输出 `.output/`。
- Chrome/Edge 为 primary targets；Firefox feature-compatible（预告片播放降级为跳转）。

## 7. 版本与更新

- **版本号唯一来源**：`package.json` 的 `version`。`wxt.config.ts` 的 manifest **不写** version —— WXT 会自动注入（实测：删掉该行后重新构建，产物 `manifest.version` 仍等于 `package.json` 的值）。任何地方都不再出现版本字面量，展示走 `browser.runtime.getManifest().version`。
- **涨位规则**：MAJOR = 破坏性（设置存储格式不兼容、移除已发布能力、要求用户重配凭据）；MINOR = 新增功能（新预览源、新跳转平台、新设置项）；PATCH = 修复。Chrome manifest 的 version 只接受 **1–4 段、每段 0–65535 的整数**，不接受 `-beta` / `+build`；预发布请用第 4 位（如 `2.1.0.1`）。
- **更新检查**：`jt:check-update` 由 background 请求自己 Release 上的 `version.json` 资产（`https://github.com/<发布仓库>/releases/latest/download/version.json`，发布仓库见下条），**不使用 GitHub API**（未认证仅 60 次/小时/IP，多用户共用出口会互相挤爆；`releases/latest/download/<asset>` 无配额、走 CDN、跟随 latest）。10 s 超时，非 2xx / 非法 JSON / 网络失败一律静默当作"没有更新"。
- **节流与记忆**：状态存 `localStorage` 的 `javranking_update_state`：`checkedAt`（上次成功检查时间）、`latest`（上次查到的可用更新，节流期内复用，避免关掉面板再开就看不到提示）、`dismissedVersion`（用户关掉的版本）。24 小时内不重复请求；同一版本关闭后不再提示，出现更高版本会重新提示。检查失败**不写** `checkedAt`，下次打开面板再试。
- **`version.json` 资产格式**（发版时随 Release 上传，与 zip 同批）：
  `{"version":"2.1.0","url":"<zip 直链，须 https>","notes":"可选"}`
  `url` 缺失或非 https 时退回 Release 页；`version` 非法则整份资产视为无效。
- **分发方式的限制**：扩展以 unpacked ZIP 分发，**Chrome 不会自动更新**（`runtime.requestUpdateCheck` 与自托管 `update_url` 对 unpacked 均不适用），因此流程只能是"发现 → 顶部提示 → 手动解压覆盖 + Reload"。一旦上架 Chrome Web Store，`manifest.version` 就成为唯一更新机制，涨位规则必须从现在起守住。
- **发版流程**：`npm run release <patch|minor|major|x.y.z>`（即 `node scripts/release.ts`）。它会依次：校验工作树干净、从 `origin` 解析发布仓库 → 按提交前缀（feat/fix/perf/其他）生成 CHANGELOG 段 → 只改 `package.json` 的版本 → 跑 `npm test` 与 `npm run compile` → `npm run zip` 并校验产物 `manifest.version` 与 `package.json` 一致 → 校验产物里的发布仓库与 `origin` 一致 → 生成 `.output/version.json` 与 `.output/release-notes.md` → 提交并打 `v<版本>` tag。`--dry-run` 只打印计划；`--push` 才推送，装了 `gh` 会顺手建 Release，否则打印手动步骤（附 `gh release create` 命令）。
- **发布仓库不硬编码**：`wxt.config.ts` 构建时用 `parseRepoSlug(git remote get-url origin)` 注入 `__RELEASES_REPO__`（可用环境变量 `RELEASES_REPO=owner/repo` 覆盖），`src/lib/release.ts` 据此拼检查地址；未注入时才回退到常量。这样"文档写 A、实际发到 B"不会让检查静默失效。
- 首次发版前建议先给历史打一个基线 tag（如 `git tag v2.0.1`），否则第一段 CHANGELOG 会包含全部历史提交（脚本截断到 40 条并注明省略数）。
