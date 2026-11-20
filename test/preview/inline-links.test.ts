import { describe, expect, it } from "vitest";
import { parseTitleLines } from "../../src/lib/inline-links";

/** 把片段拼回文本，用于断言「降级为纯文本时不丢内容」 */
const flatten = (lines: ReturnType<typeof parseTitleLines>): string =>
	lines.map((segs) => segs.map((s) => s.text).join("")).join("\n");

/** 链接片段的断言构造器，避免每条用例重复展开对象字面量 */
const link = (href: string, text: string) => ({
	type: "link" as const,
	href,
	text,
});

describe("parseTitleLines：标题/介绍里的 <a> 恢复", () => {
	it("标准 a 标签切成 文本/链接/文本 三段", () => {
		const lines = parseTitleLines(
			'前文案「<a href="https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_646948/">原作第一卷</a>」后文案',
		);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toEqual([
			{ type: "text", text: '前文案"' },
			link("https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_646948/", "原作第一卷"),
			{ type: "text", text: '"后文案' },
		]);
	});

	it("多个链接与 <br><br> 混排：空行过滤、链接落在正确行", () => {
		const lines = parseTitleLines(
			'介绍第一段<br><br>「<a href="https://example.com/1">其一</a>」<br>「<a href="https://example.com/2">其二</a>」',
		);
		expect(lines).toHaveLength(3);
		expect(lines[0]).toEqual([{ type: "text", text: "介绍第一段" }]);
		expect(lines[1]).toEqual([
			{ type: "text", text: '"' },
			link("https://example.com/1", "其一"),
			{ type: "text", text: '"' },
		]);
		expect(lines[2]).toEqual([
			{ type: "text", text: '"' },
			link("https://example.com/2", "其二"),
			{ type: "text", text: '"' },
		]);
	});

	it("译文把标签实体化后仍能恢复链接与换行", () => {
		const lines = parseTitleLines(
			"前文&lt;br&gt;&lt;a href=&quot;https://example.com/x&quot;&gt;译名&lt;/a&gt;后文",
		);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toEqual([{ type: "text", text: "前文" }]);
		expect(lines[1]).toEqual([
			link("https://example.com/x", "译名"),
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
			link("https://example.com/y", "大写链接"),
		]);
	});
});

describe("全角 / 中文标点统一为半角英文符号", () => {
	// 微软兜底翻译的真实返回片段（2026-11-19 实测 MIMK-047）：属性引号被改成弯引号，
	// 原实现取不到 href，整段降级为纯文本，面板露出源码。
	const bingSample =
		'【最美好的人生已经开始！！】<br><br><a href=“http://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_096142/” target=“_blank”>【同人】原创作品《人类操控道具：任何地方成人服务贴纸》来了！ </a>';

	it("微软译文：弯引号属性仍能恢复成链接", () => {
		const lines = parseTitleLines(bingSample);
		expect(lines).toHaveLength(2);
		const links = lines.flat().filter((s) => s.type === "link");
		expect(links).toHaveLength(1);
		expect(links[0]).toEqual(
			link(
				"http://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_096142/",
				"[同人]原创作品<人类操控道具:任何地方成人服务贴纸>来了! ",
			),
		);
		expect(flatten(lines)).not.toContain("<a ");
	});

	it("常用中文标点转半角", () => {
		const lines = parseTitleLines(
			"标题：ＡＢＣ１２３，测试。另一句！可以吗？是啊；好、行（备注）【重点】《书名》～省略…",
		);
		expect(flatten(lines)).toBe(
			'标题:ABC123,测试.另一句!可以吗?是啊;好,行(备注)[重点]<书名>~省略...',
		);
	});

	it("弯引号与全角空格一并归一化", () => {
		expect(flatten(parseTitleLines("“引号”和‘单引号’　全角空格"))).toBe(
			"\"引号\"和'单引号' 全角空格",
		);
	});

	it("中日文引号与方括族同样转半角", () => {
		expect(flatten(parseTitleLines("「甲」『乙』〔丙〕〖丁〗"))).toBe(
			"\"甲\"'乙'[丙][丁]",
		);
	});

	it("不误伤日文假名与遮蔽符", () => {
		const raw = "メス奴●になる女達〜コース・テスト";
		expect(flatten(parseTitleLines(raw))).toBe(
			"メス奴●になる女達~コース・テスト",
		);
	});
});

describe("被换行劈开的 <a> 标签：续行合并", () => {
	it("<a 后换行、属性在下一行（dmm 源站写法）仍能恢复链接", () => {
		const lines = parseTitleLines(
			'前文\n<a\nhref="https://example.com/d_1" target="_blank">正文</a>',
		);
		expect(lines).toHaveLength(2);
		expect(lines[1]).toEqual([
			link("https://example.com/d_1", "正文"),
		]);
	});

	it("链接正文跨行时折成空格、不拆成两个标签", () => {
		const lines = parseTitleLines(
			'<a href="https://example.com/x">第一行\n第二行</a>',
		);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toEqual([
			link("https://example.com/x", "第一行 第二行"),
		]);
	});

	it("跨 5 行内闭合仍恢复链接", () => {
		const raw = [
			"<a",
			'href="https://example.com/ok"',
			'target="_blank"',
			'class="c"',
			">跨行正文</a>",
		].join("\n");
		const lines = parseTitleLines(raw);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toEqual([
			link("https://example.com/ok", "跨行正文"),
		]);
	});

	it("连续 5 行仍未闭合则降级为纯文本，内容不丢", () => {
		const raw = [
			'<a href="https://example.com/broken"',
			"第二行",
			"第三行",
			"第四行",
			"第五行",
			"第六行",
		].join("\n");
		const lines = parseTitleLines(raw);
		expect(lines.flat().every((s) => s.type === "text")).toBe(true);
		const joined = lines.map((segs) => segs.map((s) => s.text).join("")).join(" ");
		expect(joined).toContain("第六行");
	});

	it("没有 a 标签时行数不变（不误合并普通多行文本）", () => {
		expect(parseTitleLines("甲\n乙\n丙")).toHaveLength(3);
	});
});
