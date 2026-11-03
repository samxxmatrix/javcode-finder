# dmm-api

**DMM / FALENO 番号查询后端**：输入番号，返回标题、封面、预告片直链与详情页地址。浏览器扩展用它换取这两个站的预览能力。

> ## ⚠️ 必须「日本出口」（东京 hnd1）才能正常工作
>
> 本服务是你自建的**反向代理**：服务端从日本出口去抓 DMM / FALENO。两条硬约束：
>
> 1. **必须部署在东京区域（`hnd1`）**。DMM 拦截非日本出口；FALENO 拦截**大陆段**（大陆宽带一律 403，美国 / 东京出口可用）。留在默认区域大概率什么都抓不到。
> 2. **返回的 `cover_url` / `preview_url` 是源站直链**（`pics.dmm.co.jp`、`cc3001.dmm.co.jp` 等）。浏览器加载它们**仍需日本 IP**——即反代只解决「查询」，**大陆 / 非日本节点看封面与视频仍可能裂图、黑屏**，除非浏览器侧能访问日本源站，或额外部署媒体代理。
>
> **配置反代 ≠ 非日本网络能直接看到封面 / 视频。**

> **属于进阶内容**。不部署它，扩展也能用——只是 **DMM 整源不可用**（DMM 必须走日本出口），FALENO 退化为由浏览器**直连** `faleno.jp` 抓作品页（大陆宽带必 403、非大陆出口可用；拿到的 `cdn.faleno.net` 资产仍全球可达）。什么时候需要自建见 [advanced/README.md](../README.md)。

- 接口契约（路径、字段、错误码、缓存行为、档位规则）：[`接口文档.md`](./接口文档.md)
- 从零部署（前置条件、环境变量、验证清单、排查表）：[`部署指南.md`](./部署指南.md)

## 能力

| 端点 | 用途 |
| --- | --- |
| `GET /{code}` | DMM 番号详情 + 预告片档位 |
| `GET /cid/{code}` | 只查 CID / channel，用作连通性探针与轻量预取 |
| `GET /faleno/{code}` | FALENO 番号查询（`FNS` 前缀番号的**常规路径**，与 DMM 查询并列，不是兜底） |

- 鉴权：`?key=` 或请求头 `x-api-key`（不配置 `API_KEY` 则**接口完全公开**）
- 缓存：Redis 可选。不配也能跑，只是每次都真实抓取（首次 4–5 秒）
- 预告片：解析 HLS 播放列表里的多档清晰度，按 `PREVIEW_HEIGHT_MIN` / `PREVIEW_HEIGHT_MAX` 区间挑一档（默认落在 320–600，取最接近中点的一档）

## 维护者入口

代码结构、模块职责、代码地图、测试与本地自测脚本属于**实现维护内容，不面向部署用户**，统一收录在内部文档：

- [`实现与维护（代码地图 / 测试 / 实施细节）`](../../docs/workbuddy_plan/2026-11-03-dmm-api-implementation-maintenance.md)

## 部署

最短路径（细节与取舍见 [`部署指南.md`](./部署指南.md)）：

```bash
cd advanced/dmm-api/vercel-dmm
npm install
vercel login && vercel link            # 首次；项目名自定
vercel env add API_KEY production      # 必配，否则接口公开
vercel env add REDIS_URL production    # 建议：Vercel Marketplace 接 Upstash 后自动注入
vercel --prod
```

> ⚠️ **区域必须是东京（`hnd1`）**，`vercel.json` 已锁定，不要改。DMM 会拦截**非日本**出口；FALENO 拦截的是**大陆段**（2026-11-02 实测：大陆宽带带不带尾斜杠一律 403，美国 / 东京出口均 200），`hnd1` 同时满足两者。
>
> 另需注意：即便部署在 `hnd1`，接口返回的 `cover_url` / `preview_url` 仍是日本源站直链，浏览器端仍需日本出口才能显示——**反代只解决查询，不解决封面 / 视频直链的可达性**。
