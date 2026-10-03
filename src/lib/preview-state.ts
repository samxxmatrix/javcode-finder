import type {
	PreviewLookupError,
	PreviewPlaybackStatus,
	PreviewResolution,
} from "./types";

export type PreviewMediaMessageKey =
	| "no_number_information"
	| "playback_failed";

export type PreviewNoticeKey =
	| "lookup_error"
	| "used_fallback"
	| "no_trailer"
	| "playback_error";

export type PreviewRetryAction =
	| { type: "lookup" }
	| { type: "playback" }
	| { type: "multiple"; actions: ["playback", "lookup"] };

export interface PreviewPresentationInput {
	resolution: PreviewResolution | { status: "loading" };
	playbackStatus: PreviewPlaybackStatus;
	hasCover: boolean;
	hasTrailer: boolean;
	noticeDismissed: boolean;
}

export interface PreviewNotice {
	key: PreviewNoticeKey;
	errors: PreviewLookupError[];
	dismissible: boolean;
	actions?: { type: "dismiss" }[];
}

export interface PreviewPresentation {
	showSpinner: boolean;
	showCover: boolean;
	showPlayButton: boolean;
	showPlaybackRetry: boolean;
	mediaMessage: PreviewMediaMessageKey | null;
	notices: PreviewNotice[];
	retryAction: PreviewRetryAction | null;
}

export type PreviewNoticeEvent = "dismiss" | "lookup_retry" | "playback_retry";

export function transitionPreviewNotice(
	dismissed: boolean,
	event: PreviewNoticeEvent,
): boolean {
	return event === "dismiss";
}

/** `<video>.readyState` 达到此值表示已有当前帧数据（HAVE_CURRENT_DATA） */
export const HAVE_CURRENT_DATA = 2;

/** 首帧等待上限：超过即判失败，让用户能重试，而不是 loading 无限转下去 */
export const PLAYBACK_LOAD_TIMEOUT_MS = 20000;

export interface FirstFrameTarget {
	readyState: number;
	addEventListener(
		type: "loadeddata" | "playing",
		listener: () => void,
		options: { once: true },
	): void;
}

export interface FirstFrameOptions {
	timeoutMs?: number;
	onTimeout?: () => void;
}

/**
 * 首帧就绪后才进入播放态。
 *
 * 起因（用户症状）：原先 `video.play().then(() => 显示 video)` —— `play()` 在首帧解码之前
 * 就 resolve，`<video controls>` 一显示，浏览器会先画自己的半透明中央播放按钮，直到首帧数据
 * 到达才消失，看起来就是"播放按钮卡住、等视频加载完才消失"。
 *
 * 两个信号取先到者，缺一不可：
 * - `loadeddata`：首帧已解码（正常路径）；
 * - `playing`：`play()` 成功后必定触发。Chromium 会暂停 `display:none` 的 `<video>` 解码，
 *   此时 `loadeddata` 可能永不到来 —— 只等它会让 loading 永远转下去（实测踩过）。
 *
 * 重播场景元素已有帧数据，`loadeddata` 不会再触发，故先判 readyState 立即切。
 * 另可给超时上限：signal 一直不来时回调 `onTimeout`，把"卡住"变成"失败可重试"。
 *
 * @returns true = 已立即就绪；false = 已挂好一次性监听（可能含超时定时器）
 */
export function armPlayingOnFirstFrame(
	video: FirstFrameTarget,
	onReady: () => void,
	{ timeoutMs, onTimeout }: FirstFrameOptions = {},
): boolean {
	if (video.readyState >= HAVE_CURRENT_DATA) {
		onReady();
		return true;
	}

	let settled = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const fire = () => {
		if (settled) return;
		settled = true;
		if (timer !== undefined) clearTimeout(timer);
		onReady();
	};

	video.addEventListener("loadeddata", fire, { once: true });
	video.addEventListener("playing", fire, { once: true });

	if (timeoutMs !== undefined && timeoutMs > 0 && onTimeout) {
		timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			onTimeout();
		}, timeoutMs);
	}

	return false;
}

export function getPreviewPresentation(
	input: PreviewPresentationInput,
): PreviewPresentation {
	const { resolution, playbackStatus, hasCover, hasTrailer, noticeDismissed } =
		input;

	if (resolution.status === "loading") {
		return {
			showSpinner: true,
			showCover: false,
			showPlayButton: false,
			showPlaybackRetry: false,
			mediaMessage: null,
			notices: [],
			retryAction: null,
		};
	}

	const lookupFailed = resolution.status === "error";
	const hasLookupErrors = lookupFailed || resolution.errors.length > 0;
	const playbackFailed = playbackStatus === "failed";
	const notices: PreviewNotice[] = [];

	if (hasLookupErrors) {
		notices.push({
			key: "lookup_error",
			errors: resolution.errors,
			dismissible: true,
			actions: [{ type: "dismiss" }],
		});
	}

	if (
		resolution.status === "resolved" &&
		resolution.media.source === "javtrailers" &&
		resolution.errors.some((error) => error.source === "dmm")
	) {
		notices.push({
			key: "used_fallback",
			errors: [],
			dismissible: true,
			actions: [{ type: "dismiss" }],
		});
	}

	if (resolution.status === "resolved" && !hasTrailer) {
		notices.push({
			key: "no_trailer",
			errors: [],
			dismissible: true,
			actions: [{ type: "dismiss" }],
		});
	}

	if (playbackFailed) {
		notices.push({
			key: "playback_error",
			errors: [],
			dismissible: true,
			actions: [{ type: "dismiss" }],
		});
	}

	const visibleNotices = noticeDismissed
		? notices.filter((notice) => !notice.dismissible)
		: notices;
	const hasLookupRetry = hasLookupErrors;
	const retryAction: PreviewRetryAction | null =
		playbackFailed && hasLookupRetry
			? { type: "multiple", actions: ["playback", "lookup"] }
			: playbackFailed
				? { type: "playback" }
				: hasLookupRetry
					? { type: "lookup" }
					: null;

	return {
		showSpinner: false,
		showCover: resolution.status === "resolved" && hasCover,
		showPlayButton: resolution.status === "resolved" && hasTrailer,
		showPlaybackRetry: playbackFailed && noticeDismissed,
		mediaMessage: playbackFailed
			? "playback_failed"
			: resolution.status === "not_found"
				? "no_number_information"
				: null,
		notices: visibleNotices,
		retryAction,
	};
}
