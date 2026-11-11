import { describe, expect, it, vi } from "vitest";
import {
	armPlayingOnFirstFrame,
	buildPlaybackFallbackOrder,
	buildPreviewChoices,
	getPreviewPresentation,
	pickDefaultPreviewChoice,
	planCover,
	planDirectMp4Start,
	transitionPreviewNotice,
	type FirstFrameTarget,
} from "../../src/lib/preview-state";
import type {
	PreviewLookupError,
	PreviewMedia,
	PreviewResolution,
} from "../../src/lib/types";

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

	it("waits for the presented frame signal when none is available yet", () => {
		const onReady = vi.fn();
		const listeners: Record<string, () => void> = {};
		let frameCallback: (() => void) | undefined;
		const video: FirstFrameTarget = {
			readyState: 0,
			addEventListener: (type, cb, options) => {
				expect(options).toEqual({ once: true });
				listeners[type] = cb;
			},
			requestVideoFrameCallback: (cb) => {
				frameCallback = cb;
				return 1;
			},
		};

		expect(armPlayingOnFirstFrame(video, onReady)).toBe(false);
		// 首帧未到：播放态不能切（否则露出黑底 + 浏览器原生播放按钮）
		expect(onReady).not.toHaveBeenCalled();
		// 只挂 loadeddata：**不能**把 playing 当信号 —— 它在画面出来之前就触发
		expect(Object.keys(listeners)).toEqual(["loadeddata"]);
		expect(frameCallback).toBeTypeOf("function");

		frameCallback!();
		expect(onReady).toHaveBeenCalledTimes(1);
		// 两个信号都到也只算一次
		listeners["loadeddata"]!();
		expect(onReady).toHaveBeenCalledTimes(1);
	});

	it("falls back to loadeddata when requestVideoFrameCallback is unavailable", () => {
		const onReady = vi.fn();
		const listeners: Record<string, () => void> = {};
		const video: FirstFrameTarget = {
			readyState: 0,
			addEventListener: (type, cb) => {
				listeners[type] = cb;
			},
		};

		armPlayingOnFirstFrame(video, onReady);
		listeners["loadeddata"]!();
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
			listeners["loadeddata"]!();
			expect(onReady).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(10000);
			expect(onTimeout).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("planDirectMp4Start", () => {
	const url = "https://cdn.example/trailer.mp4";
	const input = (
		overrides: Partial<Parameters<typeof planDirectMp4Start>[0]> = {},
	) => ({
		currentSrc: url,
		targetUrl: url,
		elementHasError: false,
		previousAttemptFailed: false,
		...overrides,
	});

	it("keeps the prefetched source on a first click so the warm buffer survives", () => {
		expect(planDirectMp4Start(input())).toEqual({
			assignSrc: false,
			reload: false,
		});
	});

	it("forces a reload when retrying the same address after a failed attempt", () => {
		// 症状：失败后沿用同一个 src，play() 不会重新走资源选择 → "重新播放"永远失败
		expect(planDirectMp4Start(input({ previousAttemptFailed: true }))).toEqual({
			assignSrc: false,
			reload: true,
		});
	});

	it("forces a reload when the prefetch errored before the first click", () => {
		expect(planDirectMp4Start(input({ elementHasError: true }))).toEqual({
			assignSrc: false,
			reload: true,
		});
	});

	it("assigns the source when nothing has been set yet", () => {
		expect(planDirectMp4Start(input({ currentSrc: null }))).toEqual({
			assignSrc: true,
			reload: false,
		});
	});

	it("assigns a changed address, which clears an element error by itself", () => {
		expect(
			planDirectMp4Start(
				input({
					currentSrc: "https://cdn.example/old.mp4",
					elementHasError: true,
				}),
			),
		).toEqual({ assignSrc: true, reload: false });
	});
});

const media: PreviewMedia = {
	source: "javtrailers",
	detailUrl: "https://javtrailers.com/ja/video/abc123",
	contentId: "abc123",
	title: "Trailer title",
	shortTitle: null,
	coverUrl: "https://images.javtrailers.com/cover.webp",
	previewUrl: "https://media.javtrailers.com/trailer.m3u8",
	previewType: "hls",
	performers: [],
	releaseDate: null,
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

describe("planCover（按记住的封面来源挑首屏封面）", () => {
	const dmmTier = {
		source: "dmm" as const,
		coverUrl: "https://pics.dmm.co.jp/pl.jpg",
		previewUrl: "https://cc.example/sample.mp4",
	};
	const jtWithTier: PreviewMedia = { ...media, fallbackTiers: [dmmTier] };

	it("偏好 1：用封面方自己的图，失败后退详情页兜底 → 后备档", () => {
		expect(planCover(jtWithTier, 1)).toEqual({
			url: media.coverUrl,
			fallback: [{ kind: "detail" }, { kind: "tier", index: 0 }],
		});
	});

	it("偏好 2 且本次有第二路封面：首屏直接用第二路，失败先回封面方再进兜底", () => {
		expect(planCover(jtWithTier, 2)).toEqual({
			url: dmmTier.coverUrl,
			// 首屏已经是后备档，回退先回封面方（JT 主封面）再走详情页兜底；
			// 已试过的后备档不再重复入链，避免原地打转
			fallback: [{ kind: "primary" }, { kind: "detail" }],
		});
	});

	it("偏好 2 但第二路没有封面：回落主封面，链里也不留空档", () => {
		expect(
			planCover(
				{ ...media, fallbackTiers: [{ ...dmmTier, coverUrl: null }] },
				2,
			),
		).toEqual({ url: media.coverUrl, fallback: [{ kind: "detail" }] });
	});

	it("偏好 2 但本次没有后备档（JT 独占该号）：回落主封面", () => {
		expect(planCover({ ...media, fallbackTiers: undefined }, 2)).toEqual({
			url: media.coverUrl,
			fallback: [{ kind: "detail" }],
		});
	});

	it("封面方不是 javtrailers：没有详情页兜底这一层，主档失败即终止", () => {
		expect(planCover({ ...media, source: "dmm" }, 1)).toEqual({
			url: media.coverUrl,
			fallback: [],
		});
	});

	it("非 javtrailers 封面方 + 第二路封面：首屏第二路，失败回主封面", () => {
		expect(
			planCover(
				{ ...media, source: "faleno", fallbackTiers: [dmmTier] },
				2,
			),
		).toEqual({
			url: dmmTier.coverUrl,
			fallback: [{ kind: "primary" }],
		});
	});

	it("没有解析结果时无封面、无回退档", () => {
		expect(planCover(null, 2)).toEqual({ url: null, fallback: [] });
	});

	it("偏好值异常时按第 1 档处理", () => {
		expect(planCover(jtWithTier, Number.NaN).url).toBe(media.coverUrl);
	});
});

describe("buildPreviewChoices（预览源切换候选档）", () => {
	const jtMedia: PreviewMedia = { ...media, fallbackTiers: undefined };
	const dmmTier = {
		source: "dmm" as const,
		coverUrl: "https://pics.example/pl.jpg",
		previewUrl: "https://cc.example/sample.mp4",
	};

	it("没有解析结果时返回空列表", () => {
		expect(buildPreviewChoices(null)).toEqual([]);
	});

	it("只有主档时给出单档（控件不显示），JT 为 HLS 短码 JT", () => {
		expect(buildPreviewChoices(jtMedia)).toEqual([
			{
				key: "primary",
				tierIndex: null,
				source: "javtrailers",
				previewUrl: media.previewUrl,
				directMp4: false,
			},
		]);
	});

	it("JT 主档 + DMM 后备档给出两档，后备档是 mp4 直链", () => {
		const choices = buildPreviewChoices({
			...jtMedia,
			fallbackTiers: [dmmTier],
		});

		expect(choices).toHaveLength(2);
		expect(choices[1]).toEqual({
			key: "tier-0",
			tierIndex: 0,
			source: "dmm",
			previewUrl: dmmTier.previewUrl,
			directMp4: true,
		});
	});

	it("后备档没有预告地址时不列为可切换档", () => {
		const choices = buildPreviewChoices({
			...jtMedia,
			fallbackTiers: [{ ...dmmTier, previewUrl: null }],
		});

		expect(choices.map((choice) => choice.key)).toEqual(["primary"]);
	});

	it("主档没有预告地址时仍可用后备档", () => {
		const choices = buildPreviewChoices({
			...jtMedia,
			previewUrl: null,
			fallbackTiers: [dmmTier],
		});

		expect(choices.map((choice) => choice.key)).toEqual(["tier-0"]);
	});

	it("FALENO 后备档保留来源，供按钮的悬停提示使用", () => {
		const choices = buildPreviewChoices({
			...jtMedia,
			fallbackTiers: [{ ...dmmTier, source: "faleno" }],
		});

		expect(choices.map((choice) => choice.source)).toEqual([
			"javtrailers",
			"faleno",
		]);
	});
});

describe("pickDefaultPreviewChoice（记住上次选的档位）", () => {
	const choices = buildPreviewChoices({
		...media,
		fallbackTiers: [
			{
				source: "dmm",
				coverUrl: null,
				previewUrl: "https://cc.example/sample.mp4",
			},
		],
	});

	it("上次选 2 且本次有两档：默认选第 2 档", () => {
		expect(pickDefaultPreviewChoice(choices, 2)?.key).toBe("tier-0");
	});

	it("上次选 1：默认选第 1 档", () => {
		expect(pickDefaultPreviewChoice(choices, 1)?.key).toBe("primary");
	});

	it("上次选 2 但本次只有一档：回落到第 1 档", () => {
		const single = buildPreviewChoices({ ...media, fallbackTiers: undefined });
		expect(pickDefaultPreviewChoice(single, 2)?.key).toBe("primary");
	});

	it("没有可播档时返回 null", () => {
		expect(pickDefaultPreviewChoice([], 2)).toBeNull();
	});

	it("偏好值异常时按第 1 档处理", () => {
		expect(pickDefaultPreviewChoice(choices, Number.NaN)?.key).toBe("primary");
		expect(pickDefaultPreviewChoice(choices, 3)?.key).toBe("primary");
	});
});

describe("buildPlaybackFallbackOrder（手动选档后的回退顺序）", () => {
	it("默认起步 + JT 封面方：先详情页兜底再后备档", () => {
		expect(
			buildPlaybackFallbackOrder({
				coverSource: "javtrailers",
				playableTierIndexes: [0],
				startTierIndex: null,
			}),
		).toEqual([{ kind: "detail" }, { kind: "tier", index: 0 }]);
	});

	it("默认起步 + 非 JT 封面方：没有详情页兜底，直接后备档", () => {
		expect(
			buildPlaybackFallbackOrder({
				coverSource: "dmm",
				playableTierIndexes: [0, 1],
				startTierIndex: null,
			}),
		).toEqual([
			{ kind: "tier", index: 0 },
			{ kind: "tier", index: 1 },
		]);
	});

	it("手动选后备档失败：先回主档与详情页兜底，跳过已试档", () => {
		expect(
			buildPlaybackFallbackOrder({
				coverSource: "javtrailers",
				playableTierIndexes: [0],
				startTierIndex: 0,
			}),
		).toEqual([{ kind: "primary" }, { kind: "detail" }]);
	});

	it("多个后备档：跳过已试档，其余保持原序", () => {
		expect(
			buildPlaybackFallbackOrder({
				coverSource: "javtrailers",
				playableTierIndexes: [0, 1],
				startTierIndex: 1,
			}),
		).toEqual([
			{ kind: "primary" },
			{ kind: "detail" },
			{ kind: "tier", index: 0 },
		]);
	});

	it("没有可播后备档时只留详情页兜底，用尽即终止", () => {
		expect(
			buildPlaybackFallbackOrder({
				coverSource: "javtrailers",
				playableTierIndexes: [],
				startTierIndex: null,
			}),
		).toEqual([{ kind: "detail" }]);
	});
});
