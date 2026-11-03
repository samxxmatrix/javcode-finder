# JavCode Finder 浏览器扩展

[English](README.en.md) · [繁體中文](README.zh-TW.md)

JavCode Finder 会在你主动点击浏览器工具栏图标后，识别当前页面中的影片番号，并在侧边栏里围绕番号提供：

- **番号识别**：一次扫出当前页面出现的全部番号并去重。支持有码号（`IPX-118`、`DLDSS-529`）、无码号与 `FC2-*` 各种写法。识别正则与**番号排除黑名单**都可在设置里改
- **封面与预告片预览**：点击番号即按需加载封面、标题和介绍、出演者、发布日，可内联播放预告片
- **标题与出演者翻译**：简中/繁中界面自动把日文标题与出演者译成中文。可接自建翻译 Worker（DeepL）提升稳定性；未配置时退回公开翻译接口
- **页面定位**：一键在当前网页中定位并高亮该番号；同一番号多处出现时可重复点击循环定位
- **番号收藏**：以书签方式收藏看中的番号，默认只保存在本地，可在设置里开启云同步
- **云同步**：开启后把收藏番号与设置数据同步至云端（你自己的 WebDAV 空间），多台设备共用同一份
- **Emby 媒体库联动**：填入 Emby 地址与 API Key 后，面板会给已在库的作品打上标识
- **快捷跳转**：三个可自定义的外部平台按钮（名称 + 链接模板），按番号直达搜索页；模板里需要写占位符（`{code}` 或 `{番号}`）。例如链接规则填 `https://javdb.com/search?q={code}`，点击番号 `ABP-123` 时实际跳转 `https://javdb.com/search?q=ABP-123`
- **其它**：简中 / 繁中 / 英文三语界面、预览音量可调、最多每 24 小时检查一次新版本并在面板提示

> 无码号的封面与预告片需要配合下面的可选后端（`d2pass-api`），且资产直链通常仍需浏览器能访问日本源站——详见下文「可选后端」。

## 安装 Chrome 或 Edge 版本

1. 从 [GitHub Releases](https://github.com/samxxmatrix/javcode-finder/releases) 下载 Chromium ZIP。
2. 将 ZIP 解压到会保留的本地文件夹。
3. 打开 `chrome://extensions` 或 `edge://extensions`。
4. 开启 **Developer mode**，选择 **Load unpacked**，再选择包含 `manifest.json` 的解压文件夹。

Unpacked extension 的更新需要手动完成：下载并解压新版后，在扩展卡片选择 **Reload**。扩展最多每 24 小时检查一次 GitHub 上的最新版本，发现更高版本时会在侧边栏顶部给出下载入口（同一版本点关闭后不再提示）。

Firefox 可用于 temporary development load；持久安装仍需要 Mozilla 签名的 XPI，目前尚未提供。

## 从源代码验证与构建

需要 Node.js 20.19 或更高版本。

```sh
npm ci
npm run compile
npm test
npm run build
npm run zip
```

production ZIP 会输出到 `.output/`。构建产物不会提交到 Git。

发版用 `npm run release <patch|minor|major|x.y.z>`：自动改版本号（唯一来源是 `package.json`）、追加 `CHANGELOG.md`、打包并校验产物版本、打 `v<版本>` tag，并生成 Release 资产 `.output/version.json`（扩展的更新提示就读它）。加 `--dry-run` 只看计划、`--push` 才推送。

## 可选后端（进阶）

扩展**不需要任何后端就能用**：番号识别、标注、媒体库联动、设置同步、页面预览都在扩展内部完成。

[`advanced/`](advanced/README.md) 里放了三个**可选**的后端服务：`dmm-api`（DMM / FALENO 番号的预览源）、`d2pass-api`（一批无码站点的番号 → 封面与预告片）、`deepl-translate-api`（预览标题与出演者的翻译代理）。不部署它们，番号识别、定位、跳转、收藏、Emby 联动、有码号预览全部照常可用，只是缺了对应的那部分能力。每个服务都有自己的 `README.md` 与 `部署指南.md`，按需自建即可；注意部署意味着以你自己的账号去抓取公开网页，合规与平台条款请自行确认。

## 隐私

扩展只会在用户主动触发后读取当前顶层页面。它不会传送或保存页面 URL、页面文字、DOM 内容、番号候选或浏览活动。

封面与预告片数据仅在用户点击某个番号后按需加载。扩展后台（background）只带着这一个番号，向少量第三方公开页面与公开接口发起查询；若用户在设置里填入了自建后端地址，则改为向该后端查询——后端由用户自行部署与维护。必要时会与另一个公开来源并行查询、按字段合并结果。任何一次请求都只包含被点击的那个番号，不包含页面 URL、页面文字、DOM 内容或番号候选。

## 许可证

[MIT](LICENSE)
