import { describe, expect, it } from "vitest";
import { isNonInjectablePageError } from "../src/lib/non-injectable";

describe("isNonInjectablePageError", () => {
	it("识别出错误页拒绝注入的固定文案", () => {
		expect(
			isNonInjectablePageError(
				new Error("Frame with ID 0 is showing error page"),
			),
		).toBe(true);
	});

	it("识别出 chrome-error:// 形式的拒绝", () => {
		expect(
			isNonInjectablePageError(
				new Error("Cannot access a chrome-error://chromewebdata/ URL"),
			),
		).toBe(true);
	});

	it("识别出 chrome:// 内部页的拒绝", () => {
		expect(
			isNonInjectablePageError(new Error("Cannot access chrome:// URL")),
		).toBe(true);
	});

	it("大小写不敏感", () => {
		expect(
			isNonInjectablePageError(new Error("FRAME WITH ID 0 IS SHOWING ERROR PAGE")),
		).toBe(true);
	});

	it("非 Error 对象按字符串判定", () => {
		expect(isNonInjectablePageError("showing error page")).toBe(true);
	});

	it("权限缺失等真实故障不静默", () => {
		expect(
			isNonInjectablePageError(
				new Error("Extension manifest must request permission"),
			),
		).toBe(false);
	});

	it("参数不可序列化不静默", () => {
		expect(
			isNonInjectablePageError(
				new Error("Error at property 'args': Value is unserializable"),
			),
		).toBe(false);
	});

	it("普通错误不静默", () => {
		expect(isNonInjectablePageError(new Error("something went wrong"))).toBe(
			false,
		);
	});
});
