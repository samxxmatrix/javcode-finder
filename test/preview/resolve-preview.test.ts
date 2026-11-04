import { describe, expect, it, vi } from "vitest";
import { resolvePreview } from "../../src/lib/resolve-preview";
import type { PreviewLookupError, PreviewMedia } from "../../src/lib/types";

/**
 * 这批用例钉住 2026-11-02 的「2 路并发 + 字段级合并」口径：
 * - 封面/预览按**资产可达性**取（JT > FALENO > DMM），`source` 随封面方；
 * - 标题组按**数据完整度**取（DMM > FALENO > JT）；
 * - FNS 号第二路是 FALENO，DMM 只在 FALENO 查无/抛错后**串行补查一次**；
 * - 整体 resolved 时丢弃 faleno 错误（保留 dmm 错误，`used_fallback` 依赖它）。
 *
 * 各源的 contentId / detailUrl / 标题 / 出演者都刻意取不同值，任何字段取错源都会被断言抓到。
 */

const jtMedia: PreviewMedia = {
	source: "javtrailers",
	detailUrl: "https://javtrailers.com/ja/video/jt001",
	contentId: "jt001",
	title: "JT 卡片标题",
	shortTitle: null,
	coverUrl: "https://images.javtrailers.com/jt001.webp",
	previewUrl: "https://media.javtrailers.com/jt001.m3u8",
	previewType: "hls",
	performers: ["JT 出演者"],
	releaseDate: "2026-01-01",
};

const dmmMedia: PreviewMedia = {
	source: "dmm",
	detailUrl: "https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=dmm001/",
	contentId: "dmm001",
	title: "DMM 長い商品名",
	shortTitle: "DMM 短い商品名",
	coverUrl: "https://pics.dmm.co.jp/dmm001/ps.jpg",
	previewUrl: "https://cc3001.dmm.co.jp/dmm001/sample.mp4",
	previewType: "mp4",
	performers: ["DMM 出演者"],
	releaseDate: "2026-02-02",
};

const falenoMedia: PreviewMedia = {
	source: "faleno",
	detailUrl: "https://faleno.jp/top/works/fns263/",
	contentId: "fns263",
	title: "FALENO 長い説明",
	shortTitle: "FALENO 短いタイトル",
	coverUrl: "https://cdn.faleno.net/fns263_1200.jpg",
	previewUrl: "https://cdn.faleno.net/fns263_PR.mp4",
	previewType: "mp4",
	performers: ["FALENO 出演者"],
	releaseDate: "2026-03-03",
};

/** JT 出封面 + 某一路出标题（合并的常态结果） */
function mergedWithTitle(
	titleProvider: PreviewMedia,
	tier?: { source: PreviewMedia["source"]; media: PreviewMedia },
): PreviewMedia {
	return {
		...jtMedia,
		detailUrl: titleProvider.detailUrl,
		title: titleProvider.title,
		shortTitle: titleProvider.shortTitle,
		performers: titleProvider.performers,
		releaseDate: titleProvider.releaseDate,
		...(tier
			? {
					fallbackTiers: [
						{
							source: tier.source,
							coverUrl: tier.media.coverUrl,
							previewUrl: tier.media.previewUrl,
						},
					],
				}
			: {}),
	};
}

const dmmError: PreviewLookupError = {
	source: "dmm",
	kind: "api",
	status: 401,
	code: 40101,
	error: "MISSING_API_KEY",
	message: "API Key is missing.",
};

const falenoError = (status: number): PreviewLookupError => ({
	source: "faleno",
	kind: "http",
	status,
});

describe("resolvePreview —— D2PASS 链首（回归，不参与合并）", () => {
	const d2passMedia: PreviewMedia = {
		source: "d2pass",
		detailUrl: "https://www.d2pass.com/product/movies/226138",
		contentId: "HEYZO-3953",
		title: "長い説明",
		shortTitle: "短いタイトル",
		coverUrl: "https://images.d2pass.com/cover.webp",
		previewUrl: "https://smovie.heyzo.com/contents/3000/3953/sample_low.mp4",
		previewType: "mp4",
		performers: [],
		releaseDate: null,
	};

	it("D2PASS 命中即返回，且不再问 DMM/JavTrailers/FALENO", async () => {
		const dmmLookup = vi.fn(async () => dmmMedia);
		const javtrailersLookup = vi.fn(async () => jtMedia);
		const falenoLookup = vi.fn(async () => falenoMedia);
		const result = await resolvePreview({
			d2passEnabled: true,
			d2passLookup: async () => d2passMedia,
			lookupEnabled: true,
			dmmLookup,
			javtrailersLookup,
			falenoLookup,
		});

		expect(result).toEqual({
			status: "resolved",
			media: d2passMedia,
			errors: [],
		});
		expect(dmmLookup).not.toHaveBeenCalled();
		expect(javtrailersLookup).not.toHaveBeenCalled();
		expect(falenoLookup).not.toHaveBeenCalled();
	});

	it("D2PASS 查无（返回 null）不进 errors，链继续走下一源", async () => {
		const result = await resolvePreview({
			d2passEnabled: true,
			d2passLookup: async () => null,
			lookupEnabled: false,
			dmmLookup: async () => null,
			javtrailersLookup: async () => jtMedia,
		});

		expect(result).toEqual({ status: "resolved", media: jtMedia, errors: [] });
	});

	it("D2PASS 503 保留在 errors，且整轮判成 error 而不是 not_found", async () => {
		const d2passError: PreviewLookupError = {
			source: "d2pass",
			kind: "api",
			status: 503,
			code: 50301,
			error: "SOURCE_UNAVAILABLE",
		};
		const result = await resolvePreview({
			d2passEnabled: true,
			d2passLookup: async () => {
				throw d2passError;
			},
			lookupEnabled: false,
			dmmLookup: async () => null,
			javtrailersLookup: async () => null,
		});

		expect(result).toEqual({
			status: "error",
			media: null,
			errors: [d2passError],
		});
	});

	it("开关关闭时一次都不调用 d2passLookup", async () => {
		const d2passLookup = vi.fn(async () => null);
		const result = await resolvePreview({
			d2passEnabled: false,
			d2passLookup,
			lookupEnabled: false,
			dmmLookup: async () => null,
			javtrailersLookup: async () => jtMedia,
		});

		expect(d2passLookup).not.toHaveBeenCalled();
		expect(result.status).toBe("resolved");
	});

	it("d2passEnabled 为 true 但未提供 d2passLookup 时也一次都不调用", async () => {
		const javtrailersLookup = vi.fn(async () => jtMedia);
		const result = await resolvePreview({
			d2passEnabled: true,
			lookupEnabled: true,
			dmmLookup: async () => null,
			javtrailersLookup,
		});

		expect(result).toEqual({ status: "resolved", media: jtMedia, errors: [] });
		expect(javtrailersLookup).toHaveBeenCalledOnce();
	});
});

describe("resolvePreview —— 非 FNS 号（第二路 = DMM）", () => {
	it("JT 与 DMM 均命中：封面取 JT、标题组取 DMM，DMM 成为免费后备档", async () => {
		const result = await resolvePreview({
			lookupEnabled: true,
			dmmLookup: async () => dmmMedia,
			javtrailersLookup: async () => jtMedia,
			// 非 FNS 号：调用方不会提供 falenoLookup（这里显式传 undefined 表示同一形态）
			falenoLookup: undefined,
		});

		expect(result).toEqual({
			status: "resolved",
			media: mergedWithTitle(dmmMedia, {
				source: "dmm",
				media: dmmMedia,
			}),
			errors: [],
		});
		// 合并后 source 是封面方 → UI 的 mp4/HLS 分支与封面兜底自然正确
		expect(result.status === "resolved" && result.media.source).toBe(
			"javtrailers",
		);
		expect(result.status === "resolved" && result.media.contentId).toBe("jt001");
	});

	it("仅 DMM 命中：整条取 DMM、mp4 直链、无后备档（封面方自身不入后备）", async () => {
		const result = await resolvePreview({
			lookupEnabled: true,
			dmmLookup: async () => dmmMedia,
			javtrailersLookup: async () => null,
		});

		expect(result).toEqual({
			status: "resolved",
			media: dmmMedia,
			errors: [],
		});
	});

	it("仅 JT 命中：整条取 JT、无后备档", async () => {
		const result = await resolvePreview({
			lookupEnabled: true,
			dmmLookup: async () => null,
			javtrailersLookup: async () => jtMedia,
		});

		expect(result).toEqual({ status: "resolved", media: jtMedia, errors: [] });
	});

	it("DMM 抛错 + JT 命中：封面/标题都取 JT，DMM 错误保留（used_fallback 依赖它）", async () => {
		const result = await resolvePreview({
			lookupEnabled: true,
			dmmLookup: async () => {
				throw dmmError;
			},
			javtrailersLookup: async () => jtMedia,
		});

		expect(result).toEqual({
			status: "resolved",
			media: jtMedia,
			errors: [dmmError],
		});
	});

	it("DMM 抛错 + JT 查无：仍按历史口径判 not_found（DMM 故障不升级成 error）", async () => {
		const result = await resolvePreview({
			lookupEnabled: true,
			dmmLookup: async () => {
				throw dmmError;
			},
			javtrailersLookup: async () => null,
		});

		expect(result).toEqual({
			status: "not_found",
			media: null,
			errors: [dmmError],
		});
	});

	it("DMM 抛 not_found + JT 查无：错误不进 errors，判 not_found", async () => {
		const result = await resolvePreview({
			lookupEnabled: true,
			dmmLookup: async () => {
				throw {
					source: "dmm",
					kind: "not_found",
					status: 404,
					code: 40401,
					error: "ITEM_NOT_FOUND",
				} satisfies PreviewLookupError;
			},
			javtrailersLookup: async () => null,
		});

		expect(result).toEqual({ status: "not_found", media: null, errors: [] });
	});

	it("lookupEnabled=false：一次都不调用 dmmLookup（非反代用户）", async () => {
		const dmmLookup = vi.fn(async () => dmmMedia);
		const result = await resolvePreview({
			lookupEnabled: false,
			dmmLookup,
			javtrailersLookup: async () => jtMedia,
		});

		expect(dmmLookup).not.toHaveBeenCalled();
		expect(result).toEqual({ status: "resolved", media: jtMedia, errors: [] });
	});

	it("所有源均查无且存在非 not_found 错误 → status 为 error", async () => {
		const javtrailersError: PreviewLookupError = {
			source: "javtrailers",
			kind: "http",
			status: 503,
		};
		const result = await resolvePreview({
			lookupEnabled: true,
			dmmLookup: async () => null,
			javtrailersLookup: async () => {
				throw javtrailersError;
			},
		});

		expect(result).toEqual({
			status: "error",
			media: null,
			errors: [javtrailersError],
		});
	});
});

describe("resolvePreview —— FNS 号（第二路 = FALENO，DMM 仅补查）", () => {
	it("JT 与 FALENO 均命中：封面取 JT、标题取 FALENO，且 DMM 一次都不查", async () => {
		const dmmLookup = vi.fn(async () => dmmMedia);
		const result = await resolvePreview({
			lookupEnabled: true,
			dmmLookup,
			javtrailersLookup: async () => jtMedia,
			falenoLookup: async () => falenoMedia,
		});

		expect(result).toEqual({
			status: "resolved",
			media: mergedWithTitle(falenoMedia, {
				source: "faleno",
				media: falenoMedia,
			}),
			errors: [],
		});
		// 本方案的成本收益点：常态不取 DMM
		expect(dmmLookup).not.toHaveBeenCalled();
	});

	it("FALENO 查无 → 串行补查 DMM 恰好 1 次，标题取 DMM", async () => {
		const dmmLookup = vi.fn(async () => dmmMedia);
		const result = await resolvePreview({
			lookupEnabled: true,
			dmmLookup,
			javtrailersLookup: async () => jtMedia,
			falenoLookup: async () => null,
		});

		expect(dmmLookup).toHaveBeenCalledOnce();
		expect(result).toEqual({
			status: "resolved",
			media: mergedWithTitle(dmmMedia, { source: "dmm", media: dmmMedia }),
			errors: [],
		});
	});

	it("FALENO 抛错（502）→ 同样补查 DMM；resolved 时 faleno 错误被抑制", async () => {
		const dmmLookup = vi.fn(async () => dmmMedia);
		const result = await resolvePreview({
			lookupEnabled: true,
			dmmLookup,
			javtrailersLookup: async () => jtMedia,
			falenoLookup: async () => {
				throw falenoError(502);
			},
		});

		expect(dmmLookup).toHaveBeenCalledOnce();
		expect(result).toEqual({
			status: "resolved",
			media: mergedWithTitle(dmmMedia, { source: "dmm", media: dmmMedia }),
			// 收集层留痕、展示层抑制：resolved 后不再抛出「查询失败：FALENO 502」
			errors: [],
		});
	});

	it("FALENO 抛 403（大陆直连常态）+ JT 命中 → resolved 且不出现 faleno 错误", async () => {
		const result = await resolvePreview({
			lookupEnabled: false,
			dmmLookup: async () => null,
			javtrailersLookup: async () => jtMedia,
			falenoLookup: async () => {
				throw falenoError(403);
			},
		});

		expect(result).toEqual({
			status: "resolved",
			media: jtMedia,
			errors: [],
		});
	});

	it("JT 查无、FALENO 命中：整条取 FALENO（mp4）、无第三档后备", async () => {
		const result = await resolvePreview({
			lookupEnabled: true,
			dmmLookup: async () => null,
			javtrailersLookup: async () => null,
			falenoLookup: async () => falenoMedia,
		});

		expect(result).toEqual({
			status: "resolved",
			media: falenoMedia,
			errors: [],
		});
	});

	it("JT 与 FALENO 均查无、补查 DMM 命中：整条取 DMM", async () => {
		const dmmLookup = vi.fn(async () => dmmMedia);
		const result = await resolvePreview({
			lookupEnabled: true,
			dmmLookup,
			javtrailersLookup: async () => null,
			falenoLookup: async () => null,
		});

		expect(dmmLookup).toHaveBeenCalledOnce();
		expect(result).toEqual({
			status: "resolved",
			media: dmmMedia,
			errors: [],
		});
	});

	it("反代未启用（lookupEnabled=false）：FNS 号也绝不补查 DMM", async () => {
		const dmmLookup = vi.fn(async () => dmmMedia);
		const result = await resolvePreview({
			lookupEnabled: false,
			dmmLookup,
			javtrailersLookup: async () => jtMedia,
			falenoLookup: async () => null,
		});

		expect(dmmLookup).not.toHaveBeenCalled();
		expect(result).toEqual({
			status: "resolved",
			media: jtMedia,
			errors: [],
		});
	});
});

describe("resolvePreview —— 错误归集（收集层不吞事实）", () => {
	it("JT 与第二路都抛错：两条错误都保留，判 error", async () => {
		const javtrailersError: PreviewLookupError = {
			source: "javtrailers",
			kind: "network",
		};
		const result = await resolvePreview({
			lookupEnabled: true,
			dmmLookup: async () => {
				throw dmmError;
			},
			javtrailersLookup: async () => {
				throw javtrailersError;
			},
		});

		expect(result).toEqual({
			status: "error",
			media: null,
			errors: [dmmError, javtrailersError],
		});
	});

	it("FNS 号 + FALENO 抛错 + JT 抛错 → 未 resolved，faleno 错误照实保留", async () => {
		const javtrailersError: PreviewLookupError = {
			source: "javtrailers",
			kind: "http",
			status: 503,
		};
		const result = await resolvePreview({
			lookupEnabled: false,
			dmmLookup: async () => null,
			javtrailersLookup: async () => {
				throw javtrailersError;
			},
			falenoLookup: async () => {
				throw falenoError(403);
			},
		});

		expect(result.status).toBe("error");
		expect(result.errors).toEqual([falenoError(403), javtrailersError]);
	});

	it("JT 查无 + FALENO 抛错 + 无 DMM 可补查 → error（而不是 not_found）", async () => {
		const result = await resolvePreview({
			lookupEnabled: false,
			dmmLookup: async () => null,
			javtrailersLookup: async () => null,
			falenoLookup: async () => {
				throw falenoError(403);
			},
		});

		expect(result).toEqual({
			status: "error",
			media: null,
			errors: [falenoError(403)],
		});
	});

	it("JT 抛错 + FALENO 命中：resolved 并保留 JT 错误（非 faleno，不抑制）", async () => {
		const javtrailersError: PreviewLookupError = {
			source: "javtrailers",
			kind: "http",
			status: 503,
		};
		const result = await resolvePreview({
			lookupEnabled: false,
			dmmLookup: async () => null,
			javtrailersLookup: async () => {
				throw javtrailersError;
			},
			falenoLookup: async () => falenoMedia,
		});

		expect(result).toEqual({
			status: "resolved",
			media: falenoMedia,
			errors: [javtrailersError],
		});
	});
});
