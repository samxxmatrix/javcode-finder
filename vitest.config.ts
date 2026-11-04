import { defineConfig } from "vitest/config";

/**
 * 扩展侧测试配置。
 *
 * `advanced/` 下是独立部署的服务端项目，自带 node:test 套件（在各自目录跑 `npm test`）；
 * 它用的是 node:test 的断言与生命周期，与 vitest 不兼容，必须从这边排除 ——
 * 否则 `npm test` 会误收集 `advanced/javcode-api/test/*.test.mjs` 并整文件失败。
 */
export default defineConfig({
	test: {
		exclude: ["**/node_modules/**", "advanced/**", ".output/**", "dist/**"],
	},
});
