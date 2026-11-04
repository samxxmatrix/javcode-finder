# advanced

扩展的可选后端服务。**不部署任何一项，扩展依然可以正常使用**：番号识别、标注、Emby 联动、设置同步、页面预览等核心能力全部在扩展内部完成。

## 目录

```
advanced/
├── adaptive-proxy.js      通用边缘反代（Cloudflare Worker），把请求原样转发到某个上游域名
├── javcode-api/           番号查询服务（Vercel Node Function）：DMM / FALENO / 无码站
└── deepl-translate-api/   翻译服务（Cloudflare Worker）：DeepL 代理 + 永久缓存
```

| 目录 | 作用 | 平台 | 文档 |
|---|---|---|---|
| [`javcode-api/`](./javcode-api/) | 传入番号，返回标题、封面、预告片直链与元数据 | Vercel | [`README`](./javcode-api/README.md) · [`接口文档`](./javcode-api/接口文档.md) |
| [`deepl-translate-api/`](./deepl-translate-api/) | 页面整段翻译，带永久缓存 | Cloudflare Workers | 见目录内文档 |
| [`adaptive-proxy.js`](./adaptive-proxy.js) | 把请求原样转发到某个上游域名，上游由 `DOMAIN` 指定；与具体服务无关 | Cloudflare Workers | 见文件头注释 |

`javcode-api` 与 `deepl-translate-api` 互相独立，可只部署其中一个，也可都部署。`adaptive-proxy.js` 是可选的入口层：当 `*.vercel.app` 直连不理想时，用它套一层自有域名。

## 部署 javcode-api 的两个前提

1. **区域必须是东京 `hnd1`**。源站对非日本出口有拦截：DMM 拦非日本、FALENO 拦大陆段、多数无码站解析失败。部署区域已由 `vercel.json` 锁定，不要在 Dashboard 改。
2. **接口返回的封面 / 预告片仍是源站直链**，服务端不代理媒体二进制。因此「查询成功」不等于「图片能显示」——客户端所在网络若访问不了日本源站，仍会看到裂图或黑屏。这一点与查询接口无关，也无法靠改区域解决。

## 凭据与部署目标

本目录下的文档**只写占位符**：不含任何真实密钥、账号、项目名或域名。原因很简单——文档是给其他部署者看的，写死某台机器的信息既无意义也不安全。

自己的部署信息请放在**不入库**的私有文件里，例如 `advanced/SECRETS.local.md`（`.gitignore` 已通过 `secrets.local.*` 排除）。建议至少记录：

- 各服务的 API Key / 部署 token
- 实际部署到的项目名、区域、域名
- 该项目的环境变量清单

这样「照着文档部署」和「管理自己那份实例」是两件事，互不污染。

## 部署前请先确认一件事

这些服务都是**抓取公开网页**再返回结构化数据。自行部署意味着：

1. **合规风险由部署者承担**——所在地区对目标站点、内容类型、爬取行为的法律规定各不相同；
2. **平台条款要自己看一眼**——例如 Vercel 的 Hobby 档限非商业用途，AUP 对爬虫类负载有明确限制；
3. **部署者自己的账号额度会被消耗**——函数调用、带宽、KV / Redis 用量都记在你的账号上。

如果不确定，**不部署就是完全合法的默认选择**。
