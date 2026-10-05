import { describe, expect, it, vi } from "vitest";
import { resolvePreview } from "../src/lib/resolve-preview";
import type { PreviewLookupError, PreviewMedia } from "../src/lib/types";

const media: PreviewMedia = {
	source: "javtrailers",
	detailUrl: "https://javtrailers.com/video/abc123",
	contentId: "abc123",
	title: "Trailer title",
	shortTitle: null,
	coverUrl: "https://images.javtrailers.com/cover.webp",
	previewUrl: "https://media.javtrailers.com/trailer.m3u8",
	previewType: "hls",
};

const dmmError: PreviewLookupError = {
	source: "dmm",
	kind: "api",
	status: 401,
	code: 40101,
	error: "MISSING_API_KEY",
	message: "API Key is missing.",
};

const falenoMedia: PreviewMedia = {
	source: "faleno",
	detailUrl: "https://faleno.jp/top/works/fns263",
	contentId: "fns263",
	title: "長い説明",
	shortTitle: "短いタイトル",
	coverUrl: "https://cdn.faleno.net/cover.jpg",
	previewUrl: "https://cdn.faleno.net/trailer.mp4",
	previewType: "mp4",
};

describe("resolvePreview", () => {
	it("returns JavTrailers media and retains a DMM error", async () => {
		const result = await resolvePreview({
			dmmEnabled: true,
			dmmLookup: async () => {
				throw dmmError;
			},
			javtrailersLookup: async () => media,
		});

		expect(result).toEqual({
			status: "resolved",
			media,
			errors: [dmmError],
		});
	});

	it("reports not_found when DMM and JavTrailers both have no match", async () => {
		const result = await resolvePreview({
			dmmEnabled: true,
			dmmLookup: async () => null,
			javtrailersLookup: async () => null,
		});

		expect(result).toEqual({ status: "not_found", media: null, errors: [] });
	});

	it("reports not_found but retains a DMM error when JavTrailers has no match", async () => {
		const result = await resolvePreview({
			dmmEnabled: true,
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

	it("skips DMM when disabled", async () => {
		const dmmLookup = vi.fn(async () => media);
		const result = await resolvePreview({
			dmmEnabled: false,
			dmmLookup,
			javtrailersLookup: async () => media,
		});

		expect(dmmLookup).not.toHaveBeenCalled();
		expect(result.status).toBe("resolved");
	});

	it("returns a DMM hit without looking up JavTrailers", async () => {
		const dmmMedia: PreviewMedia = { ...media, source: "dmm", previewType: "mp4" };
		const javtrailersLookup = vi.fn(async () => media);
		const result = await resolvePreview({
			dmmEnabled: true,
			dmmLookup: async () => dmmMedia,
			javtrailersLookup,
		});

		expect(result).toEqual({ status: "resolved", media: dmmMedia, errors: [] });
		expect(javtrailersLookup).not.toHaveBeenCalled();
	});

	it("surfaces a JavTrailers lookup failure", async () => {
		const javtrailersError: PreviewLookupError = {
			source: "javtrailers",
			kind: "http",
			status: 503,
		};
		const result = await resolvePreview({
			dmmEnabled: false,
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

	it("retains errors from both sources when both lookups fail", async () => {
		const javtrailersError: PreviewLookupError = {
			source: "javtrailers",
			kind: "network",
		};
		const result = await resolvePreview({
			dmmEnabled: true,
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

	it("treats a DMM 404 lookup error as no-match and continues fallback", async () => {
		const javtrailersLookup = vi.fn(async () => null);
		const result = await resolvePreview({
			dmmEnabled: true,
			dmmLookup: async () => {
				throw {
					source: "dmm",
					kind: "not_found",
					status: 404,
					code: 40401,
					error: "ITEM_NOT_FOUND",
					message: "Item not found.",
				} satisfies PreviewLookupError;
			},
			javtrailersLookup,
		});

		expect(javtrailersLookup).toHaveBeenCalledOnce();
		expect(result).toEqual({ status: "not_found", media: null, errors: [] });
	});

	it("falls back to FALENO when DMM and JavTrailers both miss", async () => {
		const result = await resolvePreview({
			dmmEnabled: false,
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

	it("resolves via FALENO and retains the JavTrailers failure", async () => {
		const javtrailersError: PreviewLookupError = {
			source: "javtrailers",
			kind: "http",
			status: 503,
		};
		const result = await resolvePreview({
			dmmEnabled: false,
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

	it("reports an error when FALENO also fails after both sources miss", async () => {
		const falenoError: PreviewLookupError = {
			source: "faleno",
			kind: "network",
		};
		const result = await resolvePreview({
			dmmEnabled: false,
			dmmLookup: async () => null,
			javtrailersLookup: async () => null,
			falenoLookup: async () => {
				throw falenoError;
			},
		});

		expect(result).toEqual({
			status: "error",
			media: null,
			errors: [falenoError],
		});
	});

	it("reports not_found when FALENO also has no match", async () => {
		const result = await resolvePreview({
			dmmEnabled: false,
			dmmLookup: async () => null,
			javtrailersLookup: async () => null,
			falenoLookup: async () => null,
		});

		expect(result).toEqual({
			status: "not_found",
			media: null,
			errors: [],
		});
	});

	it("does not request FALENO when DMM or JavTrailers resolves", async () => {
		const dmmMedia: PreviewMedia = { ...media, source: "dmm", previewType: "mp4" };
		const falenoLookup = vi.fn(async () => falenoMedia);
		const dmmHit = await resolvePreview({
			dmmEnabled: true,
			dmmLookup: async () => dmmMedia,
			javtrailersLookup: async () => media,
			falenoLookup,
		});

		expect(dmmHit).toEqual({ status: "resolved", media: dmmMedia, errors: [] });
		expect(falenoLookup).not.toHaveBeenCalled();

		const javtrailersHit = await resolvePreview({
			dmmEnabled: false,
			dmmLookup: async () => null,
			javtrailersLookup: async () => media,
			falenoLookup,
		});

		expect(javtrailersHit).toEqual({
			status: "resolved",
			media,
			errors: [],
		});
		expect(falenoLookup).not.toHaveBeenCalled();
	});

	it("reports an error when JavTrailers throws and FALENO has no match", async () => {
		const javtrailersError: PreviewLookupError = {
			source: "javtrailers",
			kind: "http",
			status: 503,
		};
		const result = await resolvePreview({
			dmmEnabled: false,
			dmmLookup: async () => null,
			javtrailersLookup: async () => {
				throw javtrailersError;
			},
			falenoLookup: async () => null,
		});

		expect(result).toEqual({
			status: "error",
			media: null,
			errors: [javtrailersError],
		});
	});

	it("D2PASS 命中即返回，且不再问 DMM/JavTrailers", async () => {
		const d2passMedia: PreviewMedia = {
			source: "d2pass",
			detailUrl: "https://www.d2pass.com/product/movies/226138",
			contentId: "HEYZO-3953",
			title: "長い説明",
			shortTitle: "短いタイトル",
			coverUrl: "https://images.d2pass.com/cover.webp",
			previewUrl: "https://smovie.heyzo.com/contents/3000/3953/sample_low.mp4",
			previewType: "mp4",
		};
		const dmmLookup = vi.fn(async () => media);
		const javtrailersLookup = vi.fn(async () => media);
		const result = await resolvePreview({
			d2passEnabled: true,
			d2passLookup: async () => d2passMedia,
			dmmEnabled: true,
			dmmLookup,
			javtrailersLookup,
		});

		expect(result).toEqual({
			status: "resolved",
			media: d2passMedia,
			errors: [],
		});
		expect(dmmLookup).not.toHaveBeenCalled();
		expect(javtrailersLookup).not.toHaveBeenCalled();
	});

	it("D2PASS 查无（404）不进 errors，链继续走下一源", async () => {
		const result = await resolvePreview({
			d2passEnabled: true,
			d2passLookup: async () => null,
			dmmEnabled: false,
			dmmLookup: async () => null,
			javtrailersLookup: async () => media,
		});

		expect(result).toEqual({ status: "resolved", media, errors: [] });
	});

	it("D2PASS 503 保留在 errors，且整轮判成 error 而不是 not_found", async () => {
		const d2passError: PreviewLookupError = {
			source: "d2pass",
			kind: "api",
			status: 503,
			code: 50301,
			error: "SOURCE_UNAVAILABLE",
			message: "Upstream unavailable.",
		};
		const result = await resolvePreview({
			d2passEnabled: true,
			d2passLookup: async () => {
				throw d2passError;
			},
			dmmEnabled: false,
			dmmLookup: async () => null,
			javtrailersLookup: async () => null,
		});

		expect(result).toEqual({
			status: "error",
			media: null,
			errors: [d2passError],
		});
	});

	it("D2PASS 503 之后命中其他源：状态是 resolved，错误仍然保留", async () => {
		const result = await resolvePreview({
			d2passEnabled: true,
			d2passLookup: async () => {
				throw {
					source: "d2pass",
					kind: "api",
					status: 503,
					code: 50301,
					error: "SOURCE_UNAVAILABLE",
				} satisfies PreviewLookupError;
			},
			dmmEnabled: false,
			dmmLookup: async () => null,
			javtrailersLookup: async () => media,
		});

		expect(result.status).toBe("resolved");
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.source).toBe("d2pass");
	});

	it("开关关闭（d2passEnabled 为 false）时一次都不调用 d2passLookup", async () => {
		const d2passLookup = vi.fn(async () => null);
		const result = await resolvePreview({
			d2passEnabled: false,
			d2passLookup,
			dmmEnabled: false,
			dmmLookup: async () => null,
			javtrailersLookup: async () => media,
		});

		expect(d2passLookup).not.toHaveBeenCalled();
		expect(result).toEqual({ status: "resolved", media, errors: [] });
	});

	it("d2passEnabled 为 true 但未提供 d2passLookup 时也一次都不调用", async () => {
		const javtrailersLookup = vi.fn(async () => media);
		const result = await resolvePreview({
			d2passEnabled: true,
			dmmEnabled: true,
			dmmLookup: async () => null,
			javtrailersLookup,
		});

		// 没传 d2passLookup 时链首整段被 if (d2passEnabled && d2passLookup) 挡掉：
		// 若误调 undefined 会抛 TypeError，被记成 d2pass/network 并把整轮拖成 error
		expect(result).toEqual({ status: "resolved", media, errors: [] });
		expect(javtrailersLookup).toHaveBeenCalledOnce();
	});
});
