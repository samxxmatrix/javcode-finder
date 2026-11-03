/**
 * 沙箱专用 vitest 配置（放在 docs/ 下：docs/ 被 .gitignore 排除，不进仓库、不影响 `npm test`）。
 *
 * 为什么需要它：DSH 的 confined 沙箱**禁止程序开命名管道**，而
 *   1. vitest 默认的 `forks` 池要 fork 子进程并用管道 collect 输出 → `spawn EPERM`；
 *   2. Vite 在 Windows 上的 realpath 优化会 `exec('net use')` → 同样 EPERM。
 * 因此沙箱内跑测试要：`pool: "threads"`（用 worker_threads，不 fork）+ `preserveSymlinks: true`
 * （跳过 realpath 优化；本仓库用 npm 安装、node_modules 无符号链接，等价于 no-op）。
 *
 * 用法（仓库根目录）：
 *   npx vitest run --config tools/vitest.sandbox.config.mts [测试文件或名字过滤...]
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
	root,
	resolve: { preserveSymlinks: true },
	test: {
		pool: "threads",
		include: ["test/**/*.test.ts"],
	},
});
