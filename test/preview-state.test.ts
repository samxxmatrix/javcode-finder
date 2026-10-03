import { describe, expect, it, vi } from "vitest";
import {
	armPlayingOnFirstFrame,
	getPreviewPresentation,
	transitionPreviewNotice,
	type FirstFrameTarget,
} from "../src/lib/preview-state";
import type {
	PreviewLookupError,
	PreviewMedia,
	PreviewResolution,
} from "../src/lib/types";

describe("armPlayingOnFirstFrame", () => {
	it("switches immediately when frame data already exists (replay case)", () => {
		const onReady = vi.fn();
		const addEventListener = vi.fn();
		const video: FirstFrameTarget = { readyState: 2, addEventListener };

		expect(armPlayingOnFirstFrame(video, onReady)).toBe(true);
		expect(onReady).toHaveBeenCalledTimes(1);
		// 已有帧数据时 loadeddata 不会再触发，必须立即切，否则 spinner 永远停住
		expect(addEventListener).not.toHaveBeenCalled();
	});

	it("waits for the first-frame signal when none is available yet", () => {
		const onReady = vi.fn();
		const listeners: Record<string, () => void> = {};
		const video: FirstFrameTarget = {
			readyState: 0,
			addEventListener: (type, cb, options) => {
				expect(options).toEqual({ once: true });
				listeners[type] = cb;
			},
		};

		expect(armPlayingOnFirstFrame(video, onReady)).toBe(false);
		// 首帧未到：播放态不能切（否则浏览器原生控件会画出"卡住"的中央播放按钮）
		expect(onReady).not.toHaveBeenCalled();
		expect(Object.keys(listeners).sort()).toEqual(["loadeddata", "playing"]);

		listeners["loadeddata"]!();
		expect(onReady).toHaveBeenCalledTimes(1);
		// 两个信号都到也只算一次
		listeners["playing"]!();
		expect(onReady).toHaveBeenCalledTimes(1);
	});

	it("wakes on playing even if loadeddata never fires (hidden <video> may be paused for decode)", () => {
		const onReady = vi.fn();
		const listeners: Record<string, () => void> = {};
		const video: FirstFrameTarget = {
			readyState: 0,
			addEventListener: (type, cb) => {
				listeners[type] = cb;
			},
		};

		armPlayingOnFirstFrame(video, onReady);
		// Chromium 会暂停 display:none 的 <video> 解码 → loadeddata 迟迟不来；
		// play() 成功后 playing 必定触发，用它兜底，否则 loading 会永远转下去
		listeners["playing"]!();
		expect(onReady).toHaveBeenCalledTimes(1);
	});

	it("reports a timeout when no first-frame signal ever arrives", () => {
		vi.useFakeTimers();
		try {
			const onReady = vi.fn();
			const onTimeout = vi.fn();
			const listeners: Record<string, () => void> = {};
			const video: FirstFrameTarget = {
				readyState: 0,
				addEventListener: (type, cb) => {
					listeners[type] = cb;
				},
			};

			armPlayingOnFirstFrame(video, onReady, {
				timeoutMs: 5000,
				onTimeout,
			});
			vi.advanceTimersByTime(4999);
			expect(onTimeout).not.toHaveBeenCalled();
			vi.advanceTimersByTime(1);
			expect(onTimeout).toHaveBeenCalledTimes(1);

			// 超时后再来的信号不得把状态从失败拨回播放
			listeners["loadeddata"]!();
			expect(onReady).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("cancels the timeout once a signal arrives", () => {
		vi.useFakeTimers();
		try {
			const onReady = vi.fn();
			const onTimeout = vi.fn();
			const listeners: Record<string, () => void> = {};
			const video: FirstFrameTarget = {
				readyState: 0,
				addEventListener: (type, cb) => {
					listeners[type] = cb;
				},
			};

			armPlayingOnFirstFrame(video, onReady, {
				timeoutMs: 5000,
				onTimeout,
			});
			listeners["playing"]!();
			expect(onReady).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(10000);
			expect(onTimeout).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});

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

describe("transitionPreviewNotice", () => {
	it.each(["lookup_retry", "playback_retry"] as const)(
		"clears a dismissed notice after %s",
		(event) => {
			expect(transitionPreviewNotice(true, event)).toBe(false);
		},
	);
});

describe("getPreviewPresentation", () => {
	it("shows a spinner and no notice while resolution is loading", () => {
		expect(getPreviewPresentation(input({ status: "loading" }))).toEqual({
			showSpinner: true,
			showCover: false,
			showPlayButton: false,
			showPlaybackRetry: false,
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
				dismissible: true,
				actions: [{ type: "dismiss" }],
			},
		]);
		expect(result.retryAction).toEqual({ type: "lookup" });
	});

	it("allows lookup errors and fallback details to be dismissed", () => {
		const result = getPreviewPresentation(
			input(
				{ status: "resolved", media, errors: [dmmError] },
				{ hasCover: true, hasTrailer: true },
			),
		);

		expect(result.notices).toEqual([
			{
				key: "lookup_error",
				errors: [dmmError],
				dismissible: true,
				actions: [{ type: "dismiss" }],
			},
			{
				key: "used_fallback",
				errors: [],
				dismissible: true,
				actions: [{ type: "dismiss" }],
			},
		]);
		expect(
			getPreviewPresentation(
				input(
					{ status: "resolved", media, errors: [dmmError] },
					{ hasCover: true, hasTrailer: true, noticeDismissed: true },
				),
			).notices,
		).toEqual([]);
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
			showPlaybackRetry: false,
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
		expect(result.showPlaybackRetry).toBe(false);
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

	it("keeps playback retry available in the primary message after notice dismissal", () => {
		const result = getPreviewPresentation(
			input(
				{ status: "resolved", media, errors: [] },
				{
					hasTrailer: true,
					playbackStatus: "failed",
					noticeDismissed: true,
				},
			),
		);

		expect(result.notices).toEqual([]);
		expect(result.mediaMessage).toBe("playback_failed");
		expect(result.showPlaybackRetry).toBe(true);
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
				dismissible: true,
				actions: [{ type: "dismiss" }],
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
			{
				key: "lookup_error",
				errors: [dmmError],
				dismissible: true,
				actions: [{ type: "dismiss" }],
			},
			{
				key: "used_fallback",
				errors: [],
				dismissible: true,
				actions: [{ type: "dismiss" }],
			},
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
			{
				key: "lookup_error",
				errors: [dmmError],
				dismissible: true,
				actions: [{ type: "dismiss" }],
			},
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
