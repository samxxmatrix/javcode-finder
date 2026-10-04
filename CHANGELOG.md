# Changelog

本文件由 `npm run release` 维护：发版时按提交前缀（feat / fix / perf / 其他）自动追加一段。

## [2.0.2] - 2026-10-04

### 新功能

- 新增 npm run release（版本唯一来源 + 自动 CHANGELOG + 产物校验 + version.json 资产）
- 恢复版本更新检查（读 Release 版本资产 + 24h 节流 + 可关闭提示）
- FC2 封面优先正方形产品封面（og:image w276），取不到退回 poster
- FC2 番号走独占预览源（公开 sample API）
- 新增 FC2 番号解析与 sample/embed 响应解析
- 收拢预览源白名单为具名谓词并新增 fc2 源类型
- 默认正则支持 FC2 番号并同步旧断言
- 新增 toExternalSearchCode 把 FC2 显示码还原为 FC2-PPV 形式

### 修复

- 下载链接指向本仓库（原先指向 javranking-extension，那是另一个项目）
- 发版脚本只对 npm.cmd 走 shell，避免 commit message 被拆成多个参数
- 发版脚本检查失败/提交失败时友好中止，不再抛裸栈
- 发版脚本探测型 git 调用不再把 stderr 噪音打到终端
- 播放加载态压暗封面+加文案（实测首帧 ~7s，细环被封面吃掉像卡住）
- 改用 requestVideoFrameCallback 作为有画面信号（playing 早于首帧绘制会露黑底）
- 播放加载不再死等 loadeddata（渲染+playing 兜底+20s 超时可重试）
- 首帧就绪才切播放态，不再让原生播放按钮卡住
- 页面圆点点击与收藏判定改用面板统一口径（FC2 等原文≠归一化形式）
- FC2 番号外部跳转使用 FC2-PPV 形式

### 性能

- mp4 直链源解析后即预取元数据（实测点击→首帧 5.7s 降到 0.06s）
- FC2 封面改走 w480 缩略图代理（png 省 2.8x、jpg 省 11x）

### 其他

- 发版脚本改用 cmd.exe 调用 npm（消除 DEP0190）+ 文档补 npm run release
- 版本号收敛到 package.json，删除 wxt.config 的冗余 version
- 播放加载态去掉文案，只保留压暗封面+转圈
- 补记 FC2 两种「无此片」信号（HTTP 400 与 200+path=501）
