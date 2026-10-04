import { describe, expect, it } from "vitest";
import {
	configuredPlatforms,
	DEFAULT_SETTINGS,
	platformInitial,
	type ExtensionSettings,
} from "../src/lib/settings";

const settings = (
	overrides: Partial<ExtensionSettings> = {},
): ExtensionSettings => ({ ...DEFAULT_SETTINGS, ...overrides });

describe("configuredPlatforms", () => {
	it("只返回名称与链接规则都非空的平台，顺序固定 supjav → javdb → custom", () => {
		const platforms = configuredPlatforms(
			settings({
				supjavName: "Supjav",
				supjavTemplate: "https://a.example/?q={code}",
				// 只有模板、没有名称 → 不显示
				javdbName: "",
				javbusTemplate: "https://b.example/?q={code}",
				customName: "我的平台",
				customTemplate: "https://c.example/?q={code}",
			}),
		);

		expect(platforms).toEqual([
			{
				key: "supjav",
				name: "Supjav",
				template: "https://a.example/?q={code}",
			},
			{
				key: "custom",
				name: "我的平台",
				template: "https://c.example/?q={code}",
			},
		]);
	});

	it("只有名称、没有链接规则同样不显示", () => {
		const platforms = configuredPlatforms(
			settings({
				supjavName: "Supjav",
				supjavTemplate: "   ",
				javdbName: "JavDB",
				javbusTemplate: "https://javdb.example/?q={code}",
			}),
		);

		expect(platforms).toEqual([
			{
				key: "javdb",
				name: "JavDB",
				template: "https://javdb.example/?q={code}",
			},
		]);
	});

	it("三个都没配（默认设置）时返回空数组", () => {
		expect(configuredPlatforms(settings())).toEqual([]);
	});

	it("名称与模板按 trim 后返回，供 title 与 resolveSearchUrl 直接使用", () => {
		const [platform] = configuredPlatforms(
			settings({
				customName: "  My  ",
				customTemplate: "  https://x.example/?q={code}  ",
			}),
		);

		expect(platform).toEqual({
			key: "custom",
			name: "My",
			template: "https://x.example/?q={code}",
		});
	});
});

describe("platformInitial", () => {
	it("拉丁名称取首字母并大写", () => {
		expect(platformInitial("javdb")).toBe("J");
		expect(platformInitial("Supjav")).toBe("S");
	});

	it("中文名称取第一个汉字", () => {
		expect(platformInitial("我的平台")).toBe("我");
	});

	it("首尾空白不影响取字符", () => {
		expect(platformInitial("  Supjav  ")).toBe("S");
	});

	it("代理对（emoji）不被截成半个字符", () => {
		expect(platformInitial("🎬平台")).toBe("🎬");
	});

	it("空名称返回空串", () => {
		expect(platformInitial("")).toBe("");
		expect(platformInitial("   ")).toBe("");
	});
});
