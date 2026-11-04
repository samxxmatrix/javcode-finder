# javcode-api

一个自建的番号查询服务：传入番号，返回标题、封面、预告片直链与元数据。部署在 Vercel（东京 `hnd1`），由服务端替你访问 DMM / FALENO / 各家无码站，再把结果整理成统一 JSON。

- **一次部署、一个域名、一把 Key** —— 所有查询能力都在同一个项目里
- **七条 GET 接口**，多数场景只需其中两三条
- **无状态**：缓存可选（Redis），不配也能跑
- 接口契约见 [`接口文档.md`](./接口文档.md)

## 能查什么

| 类型 | 走哪个接口 | 说明 |
|---|---|---|
| 有码番号（`SSIS-001`） | `/dmm/:code` | 标题、封面、预告片多档、出演者、发售日 |
| 商品 ID（快查） | `/cid/:code` | 只要 DMM 商品 ID 时用它，不抓详情页 |
| FALENO 番号（`FNS-263`） | `/faleno/:code` | 作品页解析，字段与 DMM 对齐 |
| 无码番号（`HEYZO-3953`） | `/d2pass/:code` | 十几家无码站的标题、封面、预告片、商品页 |
| 番号列表 | `/dmm/batch`、`/d2pass/batch` | 一次最多 50 个，部分成功 |
| 服务状态 | `/health` | 探活 + 验 Key |

返回的 `cover_url` / `preview_url` 是**源站直链**，服务端不代理任何媒体二进制。

## 部署

1. 把本目录作为一个项目导入 Vercel（Git 集成，或在本目录执行 `vercel --prod`）。
2. 配置环境变量 **`API_KEY`**，这一个是必填项，不能留空。未配置时所有接口返回 503，不会退化成公开接口。
3. 可选配置 `REDIS_URL`（Upstash / Vercel KV 等），其余变量都有默认值。

区域与函数时长由 `vercel.json` 锁定（`hnd1`、`maxDuration: 60`），不要在 Dashboard 里改区域 —— 源站对非日本出口有拦截，改到别的区域会大面积查询失败。

部署完先自检一次：

```bash
curl "https://<your-project>.vercel.app/health?key=YOUR_API_KEY"
# → {"ok":true,"service":"javcode-api"}
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `API_KEY` | 无（**必填**） | 全站唯一 Key，覆盖包括 `/health` 在内的所有接口 |
| `REDIS_URL` | 空 | 缓存；未配置时退化为进程内缓存，功能不受影响 |
| `PREVIEW_QUALITY` | `320p` | 预告片清晰度偏好，两个分支共用。见下方「清晰度偏好」 |
| `BATCH_MAX` | `50` | 批量接口单次上限 |
| `PREVIEW_ENABLED` | `true` | 是否解析预告片 |
| `PREVIEW_VERIFY` | `true` | 是否探活预告片地址（关掉可省上游请求，代价是可能拿到失效链接） |
| `RATE_LIMIT_PER_MIN` | `120` | 限流阈值，只作用于 `/d2pass` |
| `FALENO_ORIGIN` | `https://faleno.jp` | FALENO 源站，换镜像时改这里 |
| `PROBE_BUDGET_MS` | `12000` | DMM 档位探测总预算 |
| `INCOMPLETE_CACHE_TTL_SECONDS` | `21600` | 资料不全条目的缓存时长，`0` = 一律永久 |
| `SOURCE_TIMEOUT_MS` | `6000` | D2PASS 单站抓取超时 |
| `D2PASS_TIMEOUT_MS` | `4000` | D2PASS 单次请求超时 |
| `TOTAL_BUDGET_MS` | `12000` | D2PASS 整条查询预算 |
| `NEGATIVE_TTL_HOURS` | `6` | D2PASS 负缓存时长，`0` = 不缓存查无结果 |
| `D2PASS_USE_RSC` | `true` | D2PASS 抓取策略开关 |
| `DISABLED_SITES` | 空 | 停用的加盟站，逗号分隔站点 ID |
| `SITE_PROXY_<SITE_ID>` | 空 | 分站专用出口代理，如 `SITE_PROXY_HEYZO=http://user:pass@host:port` |

### 清晰度偏好

`PREVIEW_QUALITY` 是**目标偏好**，不是精确档位：

- **DMM** 的档位来自按片枚举的 HLS playlist，高度是真实值。服务端以目标值为中心推导选档区间，挑最接近的真实档位。设 `320p` 时通常命中 `316p`。
- **D2PASS** 的档位是静态文件名候选集，**没有 `320p` 这个变体**。服务端按映射表换算，否则会先探活一个不存在的档、白跑一次请求：

  | 目标 | 普通站点 | HEYZO |
  |---|---|---|
  | `320p` | `360p` | `sample_low` |
  | `240p` | `240p` | `sample_low` |
  | `480p` | `480p` | `sample` |
  | `720p` 及以上 | 对应档位 | `sample_hd` |

调用方也可用 `?quality=720p` 单次覆盖，写法两个分支一致。

## 接口速览

```
GET /health                  探活 + 验 Key（需 Key）
GET /dmm/:code               有码完整查询
GET /dmm/batch?codes=...     有码批量（≤50）
GET /cid/:code               仅查商品 ID
GET /faleno/:code            FALENO 作品页
GET /d2pass/:code            无码单查
GET /d2pass/batch?codes=...  无码批量（≤50）
```

参数、响应字段、错误码、缓存与限流规则见 [`接口文档.md`](./接口文档.md)。

## 客户端接入

在调用方（浏览器扩展 / 脚本 / 任意客户端）侧只需要两项配置：**服务地址** + **API Key**。

判断服务是否可用时，调用 `GET /health?key=...`：

| 返回 | 含义 |
|---|---|
| 200 | 服务可用且 Key 正确 |
| `40101` / `40301` | Key 缺失或错误 |
| 503 / 超时 | 服务不可达或服务端未配置 Key |

这一步同时验证了两件事，比先发一次真实查询再猜错误更省事。建议超时按 8 秒处理。

## 本地开发

```bash
npm install
vercel dev          # 按 vercel.json 的 rewrites 起本地服务，路径与线上一致
```

`vercel dev` 会应用 `vercel.json` 的重写规则，因此本地可以直接 `curl "http://localhost:3000/dmm/SSIS-001?key=..."`。若用别的方式挂载 `api/index.js`，需要自己把路径参数转成 query（入口只读 `req.query` 里的 `src` / `mode` / `code` / `codes` / `only`）。

## 测试

```bash
npm test
```

覆盖入口层协议（OPTIONS、鉴权、健康检查、路由分发、批量参数校验、缓存聚合），用假 `req`/`res`，不依赖网络。真实上游抓取由部署后的 curl 自检覆盖。

## 代码结构

```
api/
└── index.js          唯一入口：OPTIONS / 鉴权 / health / 分发 / 统一响应
server/
├── handlers/
│   ├── dmm.js        DMM、CID、FALENO 与有码批量
│   └── d2pass.js     无码单查与批量
├── lib/dmm/          DMM 侧纯逻辑（档位选择、上游定性、缓存条目校验）
├── lib/d2pass/       无码站适配器、HTTP 封装、缓存与限流封装
└── shared/           auth / errors / respond / config / cache / router
```

**只有 `api/index.js` 是 Vercel 函数**，其余代码都在 `server/` 下。这不是风格偏好：Vercel 会把 `api/` 目录里的每个 `.js` 都当成一个独立的 Serverless Function，Hobby 计划上限 12 个 —— 把 handler / lib / shared 放进去会直接超过限额、部署失败。

分层约定：`handlers` 只做业务并返回 `{status, body, headers}`，不接触响应对象；协议层（CORS、缓存头、错误映射）全在 `server/shared/` 与入口。

## 行为与限制

- **404 与 503 严格区分**：`404` 是确认查无，`503` 是这次没查成（超时 / 网络 / 被 WAF 拦）。源站返回 403、429 一律归 `503`，否则用户会把「被拦截」误读成「片子不存在」。
- **限流只作用于 `/d2pass`**：无码查询要并发抓多家站，成本高；批量整批只计 1 次。`/dmm` 不限流。
- **不代理媒体**：封面与预告片都是源站直链。客户端所在网络访问不了日本源站时，查询能成功但图片/视频可能加载失败，这是网络问题，不是接口问题。
- **无码源会失效**：加盟站改版、下架、加风控都会让个别站点查不到。`DISABLED_SITES` 可以临时停用某个站，不必改代码。
- **合规由部署者承担**：本服务抓取公开网页并转发直链，部署与使用需自行确认所在地区的法律与目标站条款。
