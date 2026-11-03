/**
 * Node loader：把测试文件里的 `import ... from "vitest"` 指到极简替身
 * （见 tools/vitest-shim.mjs 的说明）。只在沙箱内使用。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SHIM = new URL("./vitest-shim.mjs", import.meta.url).href;

/** 支持 Vite 风格的 `import x from "./fixtures/y.html?raw"`：读文件、按文本默认导出 */
export async function load(url, context, nextLoad) {
	if (url.endsWith("?raw")) {
		const file = fileURLToPath(url.slice(0, -" ?raw".trim().length));
		const source = readFileSync(file, "utf8");
		return {
			format: "module",
			shortCircuit: true,
			source: `export default ${JSON.stringify(source)};`,
		};
	}
	return nextLoad(url, context);
}

export async function resolve(specifier, context, nextResolve) {
	if (specifier === "vitest" || specifier === "vitest/config") {
		return { url: SHIM, shortCircuit: true };
	}
	// Vite 风格的 `?raw` 导入：原样保留查询串，交给下面的 load 钩子读文件
	if (specifier.endsWith("?raw")) {
		const url = new URL(specifier, context.parentURL).href;
		return { url, shortCircuit: true };
	}
	// 仓库里的测试按 Vite 风格写无扩展名相对导入（`../src/lib/foo`），裸 Node ESM 不认 → 补 `.ts`
	if (
		specifier.startsWith(".") &&
		!specifier.includes("?") &&
		!/\.[a-z0-9]+$/i.test(specifier)
	) {
		try {
			return await nextResolve(`${specifier}.ts`, context);
		} catch {
			try {
				return await nextResolve(`${specifier}/index.ts`, context);
			} catch {
				// 落到默认解析，让真实错误暴露出来
			}
		}
	}
	return nextResolve(specifier, context);
}

export { pathToFileURL };
