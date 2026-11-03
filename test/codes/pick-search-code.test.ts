import { describe, expect, it } from "vitest";
import { pickSearchCode } from "../../src/lib/pick-search-code";
import { DEFAULT_CODE_REGEX } from "../../src/lib/settings";

/**
 * 期望值全部来自 2026-10-06 的实测（spec §16.3 A 的表格），不是推测：
 * 用 vite-node 直接跑"有码侧 extractCandidatesFromText + 无码侧 findUncensoredCandidatesWithIndex
 *  + mergeCandidateLists(..., exclude='')"这套算法得到。
 */
describe("pickSearchCode", () => {
	const pick = (input: string) => pickSearchCode(input, DEFAULT_CODE_REGEX);

	it("抽出标签前缀后面的有码番号（本次 bug 的原始输入）", () => {
		expect(pick("任务名称:-MFYD-189")).toBe("MFYD-189");
	});

	it("抽出带标签前缀的无码日期型番号", () => {
		expect(pick("任务名称：100426-001")).toBe("100426-001");
	});

	it("无码日期型保留前导零（072126-100 不许变成 72126-100）", () => {
		expect(pick("072126-100")).toBe("072126-100");
		expect(pick("标签：072126-100")).toBe("072126-100");
	});

	// 手输也必须保留 `_`：`100826_001`（一本道）与 `100826-001`（カリビアンコム）是两部作品，
	// 若这里折成 `-`，手动查询会拿到另一部片商的结果。
	it("无码日期型保留 `_`（100826_001 不得折成 100826-001）", () => {
		expect(pick("100826_001")).toBe("100826_001");
		expect(pick("100826-001")).toBe("100826-001");
		expect(pick("100826_001")).not.toBe(pick("100826-001"));
		expect(pick("标签：100826_001")).toBe("100826_001");
	});

	it("无码 3dw 形态", () => {
		expect(pick("3dw-315")).toBe("3DW-315");
	});

	it("两路都命中时只出一个", () => {
		expect(pick("HEYZO-3953")).toBe("HEYZO-3953");
	});

	it("多个番号取最靠前的", () => {
		expect(pick("ABP-123 和 IPX-118")).toBe("ABP-123");
	});

	it("有码番号的前导零保留", () => {
		expect(pick("SSIS-001")).toBe("SSIS-001");
		expect(pick("BDSM-091")).toBe("BDSM-091");
	});

	it("双命中的无码号不会被排除规则吃掉（内部固定传 exclude=''）", () => {
		// "任务名称:HEYZO-3953" 让有码侧与无码侧都不命中整串，因此只有 mergeCandidateLists 传 "" 才能
		// 抽出 HEYZO-3953；若改成传排除正则（HEYZO），mergeCandidateLists 返回空列表，
		// 于是落到 normalizeCode(整串) = "任务名称:HEYZO-3953" 而失败。
		expect(pickSearchCode("任务名称:HEYZO-3953", DEFAULT_CODE_REGEX)).toBe("HEYZO-3953");
	});

	it("已知局限：T2 形态裸输入抽不到 → 退回 normalizeCode（= 接入前行为）", () => {
		expect(pick("n3351")).toBe("N3351");
		expect(pick("ori1812")).toBe("ORI1812");
	});

	it("已知局限：'自然语言词 + 裸数字' 被有码正则吞进去（如 'site 3997'，页面扫描同样如此）", () => {
		expect(pick("site 3997")).toBe("SITE-3997");
	});

	it("完全抽不到时退回 normalizeCode(input)", () => {
		expect(pick("完全没有番号的一段中文")).toBe("完全没有番号的一段中文");
	});

	it("用设置里的自定义正则（而不是写死默认正则）", () => {
		// "ID:MAY-1234" 的 MAY-1234 被默认正则的月份排除规则挡住（JAN|FEB|...|MAY），
		// 只有把 customRegex 真正传下去才抽得出来 —— 忽略该参数的实现会退回 normalizeCode("ID:MAY-1234")。
		expect(pickSearchCode("ID:MAY-1234", "MAY-\\d{4}")).toBe("MAY-1234");
	});

	it("空输入返回空串", () => {
		expect(pickSearchCode("   ", DEFAULT_CODE_REGEX)).toBe("");
	});
});
