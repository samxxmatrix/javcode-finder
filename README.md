# JavCode Finder 浏览器扩展

[English](README.en.md) · [繁體中文](README.zh-TW.md)

JavCode Finder 会在你主动点击浏览器工具栏图标后，识别当前页面中的影片番号，并提供：

- **封面与预告片预览**：点击番号，在侧边栏内查看来自 JavTrailers 的封面，并可点击播放预告片（HLS）
- **页面定位**：一键在当前网页中定位并高亮该番号出现的位置
- **快捷跳转**：直达 JavTrailers 详情页（通过搜索页精确匹配 Content ID），或在 JavDB 中查看详情
- **自定义规则**：可自定义番号识别正则、外部跳转模板与排除站点

## 安装 Chrome 或 Edge 版本

1. 从 [GitHub Releases](https://github.com/aizhimou/javranking-extension/releases) 下载 Chromium ZIP。
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

## 隐私

扩展只会在用户主动触发后读取当前顶层页面。它不会传送或保存页面 URL、页面文字、DOM 内容、番号候选或浏览活动。

封面与预告片数据仅在用户点击番号后按需加载：javtrailers.com 搜索页、DMM API（自建反代，需自行配置）、FALENO 官网（可选兜底）、FC2 公开接口与内嵌页（`adult.contents.fc2.com`，仅 FC2 番号）。以上请求均由 background 在用户点击后发起，不包含页面 URL、页面文字、DOM 内容或番号候选。

## 许可证

[MIT](LICENSE)
