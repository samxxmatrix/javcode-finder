import { describe, expect, it } from "vitest";
import {
	normalizeReleaseDate,
	pickReleaseDate,
	toPerformers,
} from "../../src/lib/release-meta";

describe("normalizeReleaseDate", () => {
	it("接受源站四种写法并统一补零", () => {
		expect(normalizeReleaseDate("2026-10-02")).toBe("2026-10-02");
		expect(normalizeReleaseDate("2026/10/2")).toBe("2026-10-02");
		expect(normalizeReleaseDate("2026.10.2")).toBe("2026-10-02");
		expect(normalizeReleaseDate("2026年10月2日")).toBe("2026-10-02");
		expect(normalizeReleaseDate("  2026/11/05  ")).toBe("2026-11-05");
	});

	it("ISO 时间戳按 JST 取日期（数字版 deliveryStartDate 实测是 UTC 前移 9 小时）", () => {
		// DMM 数字版实测：DLDSS-529 的 deliveryStartDate = "2026-09-30T15:00:00Z"
		// → JST 2026-10-01 00:00；slice(0,10) 会得到 09-30，差一天
		expect(normalizeReleaseDate("2026-09-30T15:00:00Z")).toBe("2026-10-01");
		expect(normalizeReleaseDate("2026-09-30T15:00:00.000Z")).toBe("2026-10-01");
		expect(normalizeReleaseDate("2026-10-01T00:00:00+09:00")).toBe("2026-10-01");
		expect(normalizeReleaseDate("2026-09-30T14:59:59Z")).toBe("2026-09-30");
		expect(normalizeReleaseDate("2026-09-30T99:00:00Z")).toBeNull();
	});

	it("英文月写法（javtrailers 日语详情页 商品発売日 实测 01 Oct 2026）", () => {
		expect(normalizeReleaseDate("01 Oct 2026")).toBe("2026-10-01");
		expect(normalizeReleaseDate("  5 Sep 2026 ")).toBe("2026-09-05");
		expect(normalizeReleaseDate("1 Sept 2026")).toBe("2026-09-01");
		expect(normalizeReleaseDate("31 Feb 2026")).toBeNull();
		expect(normalizeReleaseDate("01 Xxx 2026")).toBeNull();
	});

	it("拒绝不存在的日历日期与越界值", () => {
		expect(normalizeReleaseDate("2026-02-30")).toBeNull();
		expect(normalizeReleaseDate("2026-13-01")).toBeNull();
		expect(normalizeReleaseDate("2026-00-10")).toBeNull();
		expect(normalizeReleaseDate("2026-10-00")).toBeNull();
		expect(normalizeReleaseDate("2026-10-32")).toBeNull();
		expect(normalizeReleaseDate("1899-10-02")).toBeNull();
	});

	it("非字符串、空串、混杂文本一律 null", () => {
		expect(normalizeReleaseDate(null)).toBeNull();
		expect(normalizeReleaseDate(20261002)).toBeNull();
		expect(normalizeReleaseDate("")).toBeNull();
		expect(normalizeReleaseDate("2026/10/2 配信開始")).toBeNull();
		expect(normalizeReleaseDate("配信日 2026/10/2")).toBeNull();
	});

	it("闰年 2 月 29 日合法、平年非法", () => {
		expect(normalizeReleaseDate("2024-02-29")).toBe("2024-02-29");
		expect(normalizeReleaseDate("2026-02-29")).toBeNull();
	});
});

describe("pickReleaseDate", () => {
	it("优先配信开始日，缺失或非法时回退发售日", () => {
		expect(pickReleaseDate("2026/10/2", "2026/11/05")).toBe("2026-10-02");
		expect(pickReleaseDate(null, "2026/11/05")).toBe("2026-11-05");
		expect(pickReleaseDate("  ", "2026/11/05")).toBe("2026-11-05");
		expect(pickReleaseDate("2026/13/2", "2026/11/05")).toBe("2026-11-05");
	});

	it("ISO 时间戳的配信日优先于纯日期发售日，且已换算 JST", () => {
		expect(pickReleaseDate("2026-09-30T15:00:00Z", "2026/11/05")).toBe(
			"2026-10-01",
		);
	});

	it("两个都取不到时返回 null", () => {
		expect(pickReleaseDate(null, undefined)).toBeNull();
		expect(pickReleaseDate("", "")).toBeNull();
	});
});

describe("toPerformers", () => {
	it("数组：trim、丢空与非字符串、按原样去重并保序", () => {
		expect(
			toPerformers(["柏木雫", " 吉高寧々 ", "", "柏木雫", null, 7]),
		).toEqual(["柏木雫", "吉高寧々"]);
	});

	it("字符串：按顿号、逗号、中点、斜杠切分（**不按空格切**）", () => {
		// 名字里的空格属于名字本身（0930 系实测「船井 悠佳」），按空格切会把一个人拆成两个
		expect(toPerformers("船井 悠佳")).toEqual(["船井 悠佳"]);
		expect(toPerformers("船井  悠佳")).toEqual(["船井 悠佳"]);
		expect(
			toPerformers("三上悠亜、相沢みなみ, 葵つかさ，桃乃木かな・桜空もも/架乃ゆら"),
		).toEqual([
			"三上悠亜",
			"相沢みなみ",
			"葵つかさ",
			"桃乃木かな",
			"桜空もも",
			"架乃ゆら",
		]);
	});

	it("非字符串非数组、空白串、纯分隔符 → 空数组", () => {
		expect(toPerformers(null)).toEqual([]);
		expect(toPerformers(undefined)).toEqual([]);
		expect(toPerformers("   ")).toEqual([]);
		expect(toPerformers("、、,")).toEqual([]);
		expect(toPerformers(["", "   "])).toEqual([]);
	});
});
