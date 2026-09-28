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
});
