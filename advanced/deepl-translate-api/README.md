# deepl-translate-api

**DeepL 翻译代理（Cloudflare Worker）**：单文件 Worker，把翻译请求转发给 DeepL，并把结果永久缓存到 Workers KV。浏览器扩展用它翻译页面内容。

> **属于进阶内容**。不部署它，扩展的翻译功能不可用，其余功能不受影响。什么时候需要自建见 [advanced/README.md](../README.md)。

- 接口契约（路径、字段、错误码、分段与缓存规则）：[`接口文档.md`](./接口文档.md)
- 从零部署（KV 绑定、密钥注入、验证、排查）：[`部署指南.md`](./部署指南.md)

## 能力

| 端点 | 用途 |
| --- | --- |
| `GET /` | 根路径（同样需要鉴权，不公开任何接口信息） |
| `GET /health` | 服务状态 |
| `GET /usage` | DeepL 账号用量 |
| `POST /translate` | 文本翻译 |

- 鉴权：`Authorization: Bearer <CLIENT_API_KEY>`，所有端点都要
- 缓存：Workers KV，**永久保存**。同一段文本第二次翻译不消耗 DeepL 额度，也不产生延迟
- 长文本：按 4000 字符分段并发翻译后拼回（单次请求上限 50000 字符）
- 重试：DeepL 限流或临时失败时指数退避重试，最多 3 次
- 目标语言：支持 DeepL 全部目标语言，并兼容 `zh` / `zh-CN` / `zh-TW` 这类常见写法
- 兼容：请求体同时接受本服务自有格式与 OpenAI / Google 风格的写法（详见接口文档）

## 维护者入口

代码结构、模块职责属于**实现维护内容，不面向部署用户**，统一收录在内部文档：

- [`实现与维护（代码结构 / 实施细节）`](../../docs/workbuddy_plan/2026-11-03-deepl-translate-api-implementation-maintenance.md)

## 本地开发

```bash
cd advanced/deepl-translate-api
npx wrangler dev            # 本地起服务；需要 .dev.vars 提供两个密钥
```

`.dev.vars`（**不入库**）：

```ini
DEEPL_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx
CLIENT_API_KEY=your-own-random-string
```

`.dev.vars` 不会上传到 Cloudflare，只供本地 `wrangler dev` 使用。

## 部署

```bash
cd advanced/deepl-translate-api
cp wrangler.toml.example wrangler.toml     # 首次：填好自己的 KV namespace id
npx wrangler login
npx wrangler secret put DEEPL_API_KEY
npx wrangler secret put CLIENT_API_KEY
npx wrangler deploy
```

完整步骤（含 KV 创建、自定义域名、验证与排查）见 [`部署指南.md`](./部署指南.md)。

> ⚠️ 代码里写死了 **DeepL 免费版**端点（`api-free.deepl.com`）。如果你用的是 DeepL Pro（API Key 不以 `:fx` 结尾），需要把文件开头两处 URL 改成 `api.deepl.com`，否则会一直 403。
