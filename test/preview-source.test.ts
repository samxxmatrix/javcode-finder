import { describe, expect, it } from "vitest";
import {
	canUseTitleAsShortTitle,
	isDirectMp4Source,
	sourceLabelKey,
	type SourceLabelKey,
} from "../src/lib/preview-source";
import type { PreviewLookupSource } from "../src/lib/types";

describe("isDirectMp4Source", () => {
	it("marks mp4 direct-link sources", () => {
		expect(isDirectMp4Source("dmm")).toBe(true);
		expect(isDirectMp4Source("faleno")).toBe(true);
		expect(isDirectMp4Source("fc2")).toBe(true);
		// D2PASS 预告片实测 206 video/mp4、无防盗链 ⇒ 走 <video src> 直链分支
		expect(isDirectMp4Source("d2pass")).toBe(true);
	});

	it("excludes hls sources and missing values", () => {
		expect(isDirectMp4Source("javtrailers")).toBe(false);
		expect(isDirectMp4Source(null)).toBe(false);
		expect(isDirectMp4Source(undefined)).toBe(false);
	});
});

describe("canUseTitleAsShortTitle", () => {
	it("includes sources without a dedicated short-title field", () => {
		expect(canUseTitleAsShortTitle("javtrailers")).toBe(true);
		expect(canUseTitleAsShortTitle("faleno")).toBe(true);
		expect(canUseTitleAsShortTitle("fc2")).toBe(true);
	});

	it("excludes dmm/d2pass and missing values", () => {
		// d2pass 有独立 short_title：登记了会在其缺失时把剧情当金色标题显示
		expect(canUseTitleAsShortTitle("d2pass")).toBe(false);
		expect(canUseTitleAsShortTitle("dmm")).toBe(false);
		expect(canUseTitleAsShortTitle(null)).toBe(false);
		expect(canUseTitleAsShortTitle(undefined)).toBe(false);
	});
});

describe("sourceLabelKey", () => {
	it("maps every source to its locale message key", () => {
		expect(sourceLabelKey("dmm")).toBe("dmmSourceLabel");
		expect(sourceLabelKey("javtrailers")).toBe("javtrailersSourceLabel");
		expect(sourceLabelKey("faleno")).toBe("falenoSourceLabel");
		expect(sourceLabelKey("fc2")).toBe("fc2SourceLabel");
		expect(sourceLabelKey("d2pass")).toBe("d2passSourceLabel");
	});
});

/**
 * 三张手工真值表（上面）只能证明"我记得加的那些"是对的，抓不住"新增源时忘了登记"：
 * `sourceLabelKey` 的 `default` 会静默伪装成 JavTrailers，两个谓词会静默落 `false`。
 * 下面这张 `Record<PreviewLookupSource, …>` 总表把这件事变成**编译期**约束 ——
 * 往 `src/lib/types.ts` 的 `PreviewLookupSource` 加一个源，
 * `npm run compile`（`tsc --noEmit`，`.wxt/tsconfig.json` 的 include 覆盖 test/）立刻报
 * `Property 'xxx' is missing in type …`，逼作者同时决定三件事：是否直链、是否用 title 当短标题、错误标签用哪个键。
 */
const SOURCE_MATRIX: Record<
	PreviewLookupSource,
	{ directMp4: boolean; titleAsShort: boolean; labelKey: SourceLabelKey }
> = {
	dmm: { directMp4: true, titleAsShort: false, labelKey: "dmmSourceLabel" },
	javtrailers: {
		directMp4: false,
		titleAsShort: true,
		labelKey: "javtrailersSourceLabel",
	},
	faleno: { directMp4: true, titleAsShort: true, labelKey: "falenoSourceLabel" },
	fc2: { directMp4: true, titleAsShort: true, labelKey: "fc2SourceLabel" },
	d2pass: { directMp4: true, titleAsShort: false, labelKey: "d2passSourceLabel" },
};

describe("来源穷尽性（新增源时的编译期护栏）", () => {
	it("谓词与标签映射对每个源都与总表一致", () => {
		for (const source of Object.keys(SOURCE_MATRIX) as PreviewLookupSource[]) {
			const expected = SOURCE_MATRIX[source];
			expect(isDirectMp4Source(source)).toBe(expected.directMp4);
			expect(canUseTitleAsShortTitle(source)).toBe(expected.titleAsShort);
			expect(sourceLabelKey(source)).toBe(expected.labelKey);
		}
	});

	it("总表列全五个源，不多不少", () => {
		expect(Object.keys(SOURCE_MATRIX).sort()).toEqual(
			["dmm", "d2pass", "faleno", "fc2", "javtrailers"].sort(),
		);
	});
});
