/**
 * 纯 Node 测试运行器（沙箱内替代 `npx vitest`，见 tools/vitest-shim.mjs 的说明）。
 *
 * 用法（仓库根目录；参数是测试文件路径，可多个）：
 *   node tools/run-tests-node.mjs test/release-meta.test.ts test/concurrency.test.ts
 * 不带参数时跑 test/ 下全部 *.test.ts。
 *
 * 退出码：有用例失败 → 1。
 */
import { readdirSync } from "node:fs";
import { register } from "node:module";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

register("./vitest-shim-loader.mjs", import.meta.url);

// 替身覆盖面有限（不支持 it.each / 假定时器 / .rejects）：未处理的拒绝要记成失败而不是崩掉整轮
process.on("unhandledRejection", (reason) => {
	console.error(`FAIL  未处理的 Promise 拒绝：${reason?.stack ?? reason}`);
	process.exitCode = 1;
});

const args = process.argv.slice(2);
const files =
	args.length > 0
		? args
		: readdirSync("test")
				.filter((name) => name.endsWith(".test.ts"))
				.map((name) => `test/${name}`)
				.sort();

for (const file of files) {
	const url = pathToFileURL(resolvePath(file)).href;
	try {
		await import(url);
	} catch (error) {
		console.error(`FAIL  加载 ${file}\n      ${error?.stack ?? error}`);
		process.exitCode = 1;
	}
}

const shim = await import("./vitest-shim.mjs");
await shim.report();
