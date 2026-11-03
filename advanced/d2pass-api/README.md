# d2pass-api

**18 家无码站点的番号查询后端**：输入番号，返回标题、封面、出演者、发行日、预告片直链与 D2Pass 商品页地址。浏览器扩展用它为这些站点补充预览与元数据。

> ## ⚠️ 必须「日本出口」（东京 hnd1）才能正常工作
>
> 本服务是你自建的**反向代理**：服务端从日本出口去抓 18 家无码站。两条硬约束：
>
> 1. **必须部署在东京区域（`hnd1`）**。非日本出口访问这些无码站大多会被拦截或解析失败。
> 2. **返回的 `cover_url` / `preview_url` 是各站点源站直链**（如 caribbeancom、heyzo 等 CDN）。浏览器加载它们**仍需日本 IP**——即反代只解决「查询」，**大陆 / 非日本节点看封面与视频仍可能裂图、黑屏**，除非浏览器侧能访问日本源站，或额外部署媒体代理。
>
> **配置反代 ≠ 非日本网络能直接看到封面 / 视频。**

> **属于进阶内容**。不部署它，扩展照样能用——只是这批站点没有封面/预告片，只有番号识别与标注。什么时候需要自建见 [advanced/README.md](../README.md)。

- 接口契约（路径、字段、错误码、缓存行为、预告片档位）：[`接口文档.md`](./接口文档.md)
- 从零部署（前置条件、环境变量全表、验证清单、排查表）：[`部署指南.md`](./部署指南.md)

## 能力

| 端点 | 用途 |
| --- | --- |
| `GET /{code}` | 按番号查询（推荐写法） |
| `GET /api?code={code}` | 等价写法 |
| `GET /batch?codes=A,B,C` | 批量查询。扩展扫一页常有 10–50 个番号，**优先用这个** |

常用参数：`refresh=1`（绕过缓存重解析）、`debug=1`（返回解析中间状态）、`no_preview=1`（只要元数据，跳过预告片）、`quality=720p`（覆盖清晰度偏好）。

- 鉴权：`?key=` 或请求头 `x-api-key`（不配置 `API_KEY` 则**接口完全公开**）
- 缓存：Redis。正结果**永久保存**，负结果默认 6 小时；`refresh=1` 是唯一的强制更新手段
- 站点覆盖：18 家适配器，其中 2 家（站点已停服 / 详情页失效）实测不可解析，真实可用 **16/18**
- 预告片：默认 480p 优先（体积约为 1080p 的 1/4）

## 维护者入口

代码结构、模块职责、代码地图、测试与本地验证脚本属于**实现维护内容，不面向部署用户**，统一收录在内部文档：

- [`实现与维护（代码地图 / 测试 / 实施细节）`](../../docs/workbuddy_plan/2026-11-03-d2pass-api-implementation-maintenance.md)

## 部署

最短路径（细节与取舍见 [`部署指南.md`](./部署指南.md)）：

```bash
cd advanced/d2pass-api/vercel-d2pass
npm ci
vercel login && vercel link            # 首次；Root Directory 保持 ./
vercel env add API_KEY production      # 必配，否则接口公开
vercel env add REDIS_URL production    # 建议：Vercel Marketplace 接 Upstash 后自动注入
vercel --prod
```

> ⚠️ **部署前先确认区域是东京（`hnd1`）**。它**不在** `vercel.json` 里——本项目用显式 `builds`，带不了 `regions`，区域是项目设置 `serverlessFunctionRegion`。CLI 首次创建的项目会拿到默认区域，必须去 Dashboard 改成 Tokyo；部署后用响应头 `x-vercel-id` 的**后一段**核对。
>
> 另需注意：即便部署在 `hnd1`，接口返回的 `cover_url` / `preview_url` 仍是各站点源站直链，浏览器端仍需日本出口才能显示——**反代只解决查询，不解决封面 / 视频直链的可达性**。
>
> `vercel.json` 必须用显式 `builds`（不是 `functions` + `rewrites`），否则函数根本不会被编译。
>
> `deploy-rest.mjs` 是**备选**：只在跑不了 CLI 的环境里用（CLI 内部要 spawn 子进程走管道，受限沙箱会失败）。它会把 `regions: ["hnd1"]` 随部署请求一起传。
