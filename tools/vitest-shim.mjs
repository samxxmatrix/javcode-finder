/**
 * 极简 vitest 替身（沙箱内用；docs/ 不入 git）。
 *
 * 为什么需要：confined 沙箱禁止开命名管道，vitest 的 forks 池与 esbuild 服务进程都会 `spawn EPERM`，
 * 于是 `npx vitest` 起不来。这个替身让**真实的 test/*.test.ts** 在纯 Node（原生 TS 类型擦除）下执行，
 * 证据与 `npm test` 是同一份测试代码。
 *
 * 覆盖范围：describe / it / expect 的 toBe / toEqual / toBeNull / toBeUndefined / toBeTruthy /
 * toContain / toHaveLength / toBeLessThanOrEqual / toHaveProperty（含 `.not`），以及 `vi.fn()` 的最小实现。
 * 未覆盖的 matcher 会让该用例失败并提示"替身未实现"，不会静默通过。
 */

const results = { passed: 0, failed: 0, pending: [] };
const suiteStack = [];

function stringify(value) {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function deepEqual(a, b) {
	if (Object.is(a, b)) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null) return false;
	if (typeof a !== "object") return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const ka = Object.keys(a);
	const kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	return ka.every((key) => deepEqual(a[key], b[key]));
}

function makeMatchers(actual, negated) {
	const assert = (pass, message) => {
		if (negated ? pass : !pass) {
			throw new Error(message);
		}
	};
	return {
		toBe(expected) {
			assert(Object.is(actual, expected), `期望 ${stringify(expected)}，实际 ${stringify(actual)}`);
		},
		toEqual(expected) {
			assert(
				deepEqual(actual, expected),
				`期望（深比较）${stringify(expected)}，实际 ${stringify(actual)}`,
			);
		},
		toBeNull() {
			assert(actual === null, `期望 null，实际 ${stringify(actual)}`);
		},
		toBeUndefined() {
			assert(actual === undefined, `期望 undefined，实际 ${stringify(actual)}`);
		},
		toBeTruthy() {
			assert(Boolean(actual), `期望真值，实际 ${stringify(actual)}`);
		},
		toContain(expected) {
			const pass =
				typeof actual === "string"
					? actual.includes(expected)
					: Array.isArray(actual) && actual.some((item) => deepEqual(item, expected));
			assert(pass, `期望包含 ${stringify(expected)}，实际 ${stringify(actual)}`);
		},
		toHaveLength(expected) {
			assert(
				actual != null && actual.length === expected,
				`期望长度 ${expected}，实际 ${actual?.length}`,
			);
		},
		toBeLessThanOrEqual(expected) {
			assert(actual <= expected, `期望 <= ${expected}，实际 ${stringify(actual)}`);
		},
		toBeLessThan(expected) {
			assert(actual < expected, `期望 < ${expected}，实际 ${stringify(actual)}`);
		},
		toBeGreaterThan(expected) {
			assert(actual > expected, `期望 > ${expected}，实际 ${stringify(actual)}`);
		},
		toBeGreaterThanOrEqual(expected) {
			assert(actual >= expected, `期望 >= ${expected}，实际 ${stringify(actual)}`);
		},
		toMatch(expected) {
			const pass =
				expected instanceof RegExp
					? expected.test(String(actual))
					: String(actual).includes(String(expected));
			assert(pass, `期望匹配 ${expected}，实际 ${stringify(actual)}`);
		},
		toHaveBeenCalled() {
			const calls = actual?.mock?.calls ?? [];
			assert(calls.length > 0, `期望被调用，实际 0 次`);
		},
		toHaveBeenCalledTimes(expected) {
			const calls = actual?.mock?.calls ?? [];
			assert(
				calls.length === expected,
				`期望被调用 ${expected} 次，实际 ${calls.length} 次`,
			);
		},
		toHaveBeenCalledOnce() {
			const calls = actual?.mock?.calls ?? [];
			assert(calls.length === 1, `期望被调用 1 次，实际 ${calls.length} 次`);
		},
		toThrow(expected) {
			if (typeof actual !== "function") {
				throw new Error("toThrow 需要一个函数（.rejects/.resolves 在替身里未实现）");
			}
			let thrown = null;
			try {
				actual();
			} catch (error) {
				thrown = error;
			}
			if (negated) {
				if (thrown !== null) throw new Error(`期望不抛错，实际抛出 ${thrown}`);
				return;
			}
			if (thrown === null) throw new Error("期望抛错，实际没有抛");
			if (typeof expected === "function" && !(thrown instanceof expected)) {
				throw new Error(
					`抛出的错误类型不符：期望 ${expected.name}，实际 ${thrown?.constructor?.name}`,
				);
			}
			if (
				typeof expected === "string" &&
				!String(thrown?.message ?? thrown).includes(expected)
			) {
				throw new Error(`错误信息不含 "${expected}"，实际 "${thrown?.message ?? thrown}"`);
			}
		},
		toHaveProperty(key) {
			const pass =
				actual != null && Object.prototype.hasOwnProperty.call(actual, key);
			assert(pass, `期望拥有属性 ${key}，实际键 ${stringify(Object.keys(actual ?? {}))}`);
		},
	};
}

export function expect(actual) {
	return {
		...makeMatchers(actual, false),
		get not() {
			return makeMatchers(actual, true);
		},
		/** `await expect(promise).resolves.toEqual(x)` */
		get resolves() {
			return new Proxy(
				{},
				{
					get: (_target, name) => (...args) =>
						Promise.resolve(actual).then((value) =>
							makeMatchers(value, false)[name](...args),
						),
				},
			);
		},
		/** `await expect(promise).rejects.toThrow("boom")` */
		get rejects() {
			return new Proxy(
				{},
				{
					get: (_target, name) => async (...args) => {
						let value;
						try {
							value = await actual;
						} catch (error) {
							if (name === "toThrow" && typeof args[0] === "string") {
								const message = String(error?.message ?? error);
								if (!message.includes(args[0])) {
									throw new Error(`拒绝原因不含 "${args[0]}"：${message}`);
								}
								return;
							}
							return makeMatchers(error, false)[name](...args);
						}
						throw new Error(`期望 Promise 拒绝，实际成功并返回 ${stringify(value)}`);
					},
				},
			);
		},
	};
}

export function describe(name, fn) {
	suiteStack.push(name);
	try {
		fn();
	} finally {
		suiteStack.pop();
	}
}

export function it(name, fn) {
	const label = [...suiteStack, name].join(" › ");
	try {
		const outcome = fn();
		if (outcome && typeof outcome.then === "function") {
			results.pending.push(
				outcome.then(
					() => {
						results.passed += 1;
					},
					(error) => {
						results.failed += 1;
						console.error(`FAIL  ${label}\n      ${error?.message ?? error}`);
					},
				),
			);
			return;
		}
		results.passed += 1;
	} catch (error) {
		results.failed += 1;
		console.error(`FAIL  ${label}\n      ${error?.message ?? error}`);
	}
}

/** `vi.fn()` 的最小实现：只够让依赖它的测试不因 import 失败而崩 */
export const vi = {
	fn(impl) {
		const calls = [];
		const mock = (...args) => {
			calls.push(args);
			return impl ? impl(...args) : undefined;
		};
		mock.mock = { calls };
		mock.mockClear = () => {
			calls.length = 0;
		};
		return mock;
	},
};

/** 等所有异步用例结束后打印汇总；失败时设置退出码 */
export async function report() {
	await Promise.all(results.pending);
	console.log(`\n[node-vitest 替身] 通过 ${results.passed} / 失败 ${results.failed}`);
	if (results.failed > 0) process.exitCode = 1;
}

export default { describe, it, expect, vi };
