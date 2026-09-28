import { describe, expect, it } from "vitest";
import { getPreviewPresentation } from "../src/lib/preview-state";
import type {
	PreviewLookupError,
	PreviewMedia,
	PreviewResolution,
} from "../src/lib/types";

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
	message: "DMM API unavailable",
};

const input = (
	resolution: PreviewResolution | { status: "loading" },
	overrides: Partial<Parameters<typeof getPreviewPresentation>[0]> = {},
) => ({
	resolution,
	playbackStatus: "idle" as const,
	hasCover: false,
	hasTrailer: false,
	noticeDismissed: false,
	...overrides,
});

describe("getPreviewPresentation", () => {
	it("shows a spinner and no notice while resolution is loading", () => {
		expect(getPreviewPresentation(input({ status: "loading" }))).toEqual({
			showSpinner: true,
			showCover: false,
			showPlayButton: false,
			mediaMessage: null,
			notices: [],
			retryAction: null,
		});
	});

	it("shows no-information only after a completed no-match without errors", () => {
		const result = getPreviewPresentation(
			input({ status: "not_found", media: null, errors: [] }),
		);

		expect(result.mediaMessage).toBe("no_number_information");
		expect(result.notices).toEqual([]);
		expect(result.retryAction).toBeNull();
	});

	it("retains a DMM error and lookup retry alongside a completed no-match", () => {
		const result = getPreviewPresentation(
			input({ status: "not_found", media: null, errors: [dmmError] }),
		);

		expect(result.mediaMessage).toBe("no_number_information");
		expect(result.notices).toEqual([
			{
				key: "lookup_error",
				errors: [dmmError],
				dismissible: false,
			},
		]);
		expect(result.retryAction).toEqual({ type: "lookup" });
	});

	it("keeps a resolved cover when no trailer address is available", () => {
		const result = getPreviewPresentation(
			input(
				{ status: "resolved", media: { ...media, previewUrl: null }, errors: [] },
				{ hasCover: true },
			),
		);

		expect(result).toEqual({
			showSpinner: false,
			showCover: true,
			showPlayButton: false,
			mediaMessage: null,
			notices: [
				{
					key: "no_trailer",
					errors: [],
					dismissible: true,
					actions: [{ type: "dismiss" }],
				},
			],
			retryAction: null,
		});
	});

	it("shows playback failure as the primary message with a dismissible playback notice", () => {
		const result = getPreviewPresentation(
			input(
				{ status: "resolved", media, errors: [] },
				{ hasTrailer: true, playbackStatus: "failed" },
			),
		);

		expect(result.mediaMessage).toBe("playback_failed");
		expect(result.showPlayButton).toBe(true);
		expect(result.notices).toEqual([
			{
				key: "playback_error",
				errors: [],
				dismissible: true,
				actions: [{ type: "dismiss" }],
			},
		]);
		expect(result.retryAction).toEqual({ type: "playback" });
	});

	it("does not turn a lookup failure into no-information", () => {
		const lookupError: PreviewLookupError = {
			source: "javtrailers",
			kind: "network",
		};
		const result = getPreviewPresentation(
			input({ status: "error", media: null, errors: [lookupError] }),
		);

		expect(result.mediaMessage).toBeNull();
		expect(result.notices).toEqual([
			{
				key: "lookup_error",
				errors: [lookupError],
				dismissible: false,
			},
		]);
		expect(result.retryAction).toEqual({ type: "lookup" });
	});

	it("omits a dismissed dismissible no-trailer notice", () => {
		const result = getPreviewPresentation(
			input(
				{ status: "resolved", media: { ...media, previewUrl: null }, errors: [] },
				{ hasCover: true, noticeDismissed: true },
			),
		);

		expect(result.showCover).toBe(true);
		expect(result.showPlayButton).toBe(false);
		expect(result.notices).toEqual([]);
	});

	it("preserves fallback and source-error notices together with no-trailer", () => {
		const result = getPreviewPresentation(
			input(
				{
					status: "resolved",
					media: { ...media, previewUrl: null },
					errors: [dmmError],
				},
				{ hasCover: true },
			),
		);

		expect(result.mediaMessage).toBeNull();
		expect(result.showPlayButton).toBe(false);
		expect(result.notices).toEqual([
			{ key: "lookup_error", errors: [dmmError], dismissible: false },
			{ key: "used_fallback", errors: [], dismissible: false },
			{
				key: "no_trailer",
				errors: [],
				dismissible: true,
				actions: [{ type: "dismiss" }],
			},
		]);
		expect(result.retryAction).toEqual({ type: "lookup" });
	});

	it("prioritizes playback failure and preserves lookup retry when both fail", () => {
		const result = getPreviewPresentation(
			input(
				{ status: "error", media: null, errors: [dmmError] },
				{ playbackStatus: "failed" },
			),
		);

		expect(result.mediaMessage).toBe("playback_failed");
		expect(result.notices).toEqual([
			{ key: "lookup_error", errors: [dmmError], dismissible: false },
			{
				key: "playback_error",
				errors: [],
				dismissible: true,
				actions: [{ type: "dismiss" }],
			},
		]);
		expect(result.retryAction).toEqual({
			type: "multiple",
			actions: ["playback", "lookup"],
		});
	});
});
