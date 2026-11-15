import { describe, expect, it } from "vitest";
import { parseTitleLines } from "../../src/lib/inline-links";

/** 把片段拼回文本，用于断言「降级为纯文本时不丢内容」 */
const flatten = (lines: ReturnType<typeof parseTitleLines>): string =>
	lines.map((segs) => segs.map((s) => s.text).join("")).join("\n");

describe("parseTitleLines：标题/介绍里的 <a> 恢复", () => {
	it("标准 a 标签切成 文本/链接/文本 三段", () => {
		const lines = parseTitleLines(
			'前文案「<a href="https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_646948/">原作第一卷</a>」后文案',
		);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toEqual([
			{ type: "text", text: "前文案「" },
			{
				type: "link",
				href: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_646948/",
				text: "原作第一卷",
			},
			{ type: "text", text: "」后文案" },
		]);
	});

	it("多个链接与 <br><br> 混排：空行过滤、链接落在正确行", () => {
		const lines = parseTitleLines(
			'介绍第一段<br><br>「<a href="https://example.com/1">其一</a>」<br>「<a href="https://example.com/2">其二</a>」',
		);
		expect(lines).toHaveLength(3);
		expect(lines[0]).toEqual([{ type: "text", text: "介绍第一段" }]);
		expect(lines[1]).toEqual([
			{ type: "text", text: "「" },
			{ type: "link", href: "https://example.com/1", text: "其一" },
			{ type: "text", text: "」" },
		]);
		expect(lines[2]).toEqual([
			{ type: "text", text: "「" },
			{ type: "link", href: "https://example.com/2", text: "其二" },
			{ type: "text", text: "」" },
		]);
	});

	it("译文把标签实体化后仍能恢复链接与换行", () => {
		const lines = parseTitleLines(
			"前文&lt;br&gt;&lt;a href=&quot;https://example.com/x&quot;&gt;译名&lt;/a&gt;后文",
		);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toEqual([{ type: "text", text: "前文" }]);
		expect(lines[1]).toEqual([
			{ type: "link", href: "https://example.com/x", text: "译名" },
			{ type: "text", text: "后文" },
		]);
	});

	it("危险或畸形 href 降级为纯文本且内容不丢", () => {
		const cases = [
			'<a href="javascript:alert(1)">危险</a>',
			'<a href="data:text/html,x">危险</a>',
			'<a href="/relative/path">相对</a>',
			'<a href="https://example.com/a b">带空格</a>',
		];
		for (const raw of cases) {
			const lines = parseTitleLines(raw);
			expect(lines.flat().every((s) => s.type === "text")).toBe(true);
			expect(flatten(lines)).toBe(raw);
		}
	});

	it("标签不成对时按纯文本返回", () => {
		const raw = '<a href="https://example.com/x">缺尾巴';
		const lines = parseTitleLines(raw);
		expect(lines.flat().every((s) => s.type === "text")).toBe(true);
		expect(flatten(lines)).toBe(raw);
	});

	it("无标签时保持原有换行归一化语义", () => {
		expect(flatten(parseTitleLines("第一行\r\n\n   \n第二行"))).toBe(
			"第一行\n第二行",
		);
	});

	it("容忍大写标签、单引号与属性顺序", () => {
		const lines = parseTitleLines(
			"<A TARGET='_blank' HREF='https://example.com/y'>大写链接</A>",
		);
		expect(lines[0]).toEqual([
			{ type: "link", href: "https://example.com/y", text: "大写链接" },
		]);
	});
});
