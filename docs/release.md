# 提交与发版命令

两条命令覆盖日常全部流程，参数尽量少：

| 命令 | 作用 | 参数 |
| --- | --- | --- |
| `npm run commit` | 把当前所有改动 `git add -A` 并提交 | 可选一个：提交标题 |
| `npm run release` | 发版（默认小版本 + 推送） | 可选一个：版本号；另有 `--no-push` / `--dry-run` / `--skip-checks` |

> npm 会把 `--` 开头的参数当成自己的选项，所以带 flag 时要写成 `npm run release -- --dry-run`；
> 位置参数（版本号、提交标题）可以直接跟：`npm run release minor`、`npm run commit "fix: ..."`。

## 日常流程

```bash
# 1. 改完代码，提交（不带参数会自动生成提交信息）
npm run commit

# 2. 发版：不带参数 = patch（2.0.2 → 2.0.3），自动推送分支与 tag
npm run release

# 想发指定版本 / 新功能版本：
npm run release minor      # 或 major / 2.1.0
```

## `npm run commit`

1. `git status --porcelain` 看有没有改动 —— **没有改动就友好退出 0**（重复执行、链式调用都不会报错）
2. 生成提交信息：首行标题 + 正文列出改动文件（最多列 20 条，其余注明条数）
3. `git add -A` + `git commit`

标题缺省是 `chore: 同步改动（N 个文件）`。自己写标题就多一个参数：

```bash
npm run commit "fix: 修正预告片重新播放失败"
npm run commit "feat: 预告片头部加平台跳转按钮"
```

**为什么要自己写标题**：`npm run release` 生成的 CHANGELOG 按提交前缀归类
（`feat` → 新功能、`fix` → 修复、`perf` → 性能，其余含 `chore` → 其他）。
全用默认标题的话，这一版的功能/修复在 CHANGELOG 里都会落到「其他」。

只看不提交（打印将要使用的提交信息与文件清单，不做任何改动）：

```bash
npm run commit -- --dry-run
```

## `npm run release`

不带参数 = `patch`。**默认会推送分支与 tag**（发版即发布），想只留在本地加 `--no-push`。

做的检查与动作（顺序即防呆）：

1. 校验工作树干净（所以先跑 `npm run commit`）、从 `origin` 解析 `owner/repo`，并断言与扩展里更新检查的地址一致
2. 计算下一个版本号，**只改 `package.json`**（唯一版本来源）
3. 跑 `npm test` + `npm run compile`
4. 写 `package.json`、按提交前缀追加 `CHANGELOG.md`
5. `npm run zip`，校验产物 `manifest.version` 与 zip 名含版本
6. 生成 `.output/version.json`（**扩展的更新检查就读它**）+ `.output/release-notes.md`
7. `git commit`（`chore: 版本号 X -> Y`）+ `git tag vX.Y.Z`
8. 推送分支与 tag；装了 `gh` 会顺手建 GitHub Release，否则打印手动步骤

参数：

| 参数 | 说明 |
| --- | --- |
| `minor` / `major` / `2.1.0` | 指定下一版；不写 = `patch` |
| `--no-push` | 只做本地 commit + tag，不推送 |
| `--dry-run` | 只打印发版计划（版本、提交范围、CHANGELOG 段落），不写任何文件 |
| `--skip-checks` | 跳过 `npm test` + `npm run compile`（慎用，正常发版别加） |

```bash
npm run release -- --dry-run          # 先看计划
npm run release                        # patch + 推送
npm run release minor                  # 2.1.0 + 推送
npm run release -- --no-push           # 只本地
```

### 没装 gh CLI 时的收尾

本机没有 `gh` 时，脚本推送完会打印手动步骤，照着做即可：

1. 打开 `https://github.com/<owner>/<repo>/releases/new?tag=vX.Y.Z`
2. 标题 `vX.Y.Z`，正文粘贴 `.output/release-notes.md`
3. 上传**两个**附件：`.output/javcode-finder-extension-X.Y.Z-chrome.zip` 和 `.output/version.json`
   - `version.json` 必须传：扩展的更新检查就是读它，缺了用户端永远不会出现更新提示
4. 发布后用户侧最多 24 小时内出现更新提示（受节流限制）

### 失败与回滚

- 工作树不干净 → 直接退出（先 `npm run commit`）
- 测试或类型检查未通过 → 退出，此时**未改动任何文件**
- 打包/校验失败 → `package.json` 与 `CHANGELOG.md` 已被改动，按提示回滚：
  `git checkout -- package.json CHANGELOG.md`
- 推送失败（未登录 / 断网 / 冲突）→ 本地 commit 与 tag 已就绪，重试
  `git push && git push origin vX.Y.Z` 即可

## 相关文件

- [`scripts/commit.ts`](../scripts/commit.ts) —— 自动提交
- [`scripts/release.ts`](../scripts/release.ts) —— 发版
- [`scripts/release-lib.ts`](../scripts/release-lib.ts) —— 两者的纯逻辑（参数解析、提交信息、CHANGELOG 生成），单测在 [`test/release-lib.test.ts`](../test/release/release-lib.test.ts)
