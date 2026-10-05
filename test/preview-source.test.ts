import { describe, expect, it } from "vitest";
import {
	canUseTitleAsShortTitle,
	isDirectMp4Source,
	sourceLabelKey,
} from "../src/lib/preview-source";

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
