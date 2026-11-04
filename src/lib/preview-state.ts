import { isDirectMp4Source } from "./preview-source";
import type {
	PreviewLookupError,
	PreviewLookupSource,
	PreviewMedia,
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

export interface DirectMp4StartPlan {
	/** 需要写 src：地址变了（重新解析到新地址 / 兜底地址）或还没设过 */
	assignSrc: boolean;
	/** 地址没变但元素不可复用，必须先 load() 复位再重新拉流 */
	reload: boolean;
}

export interface DirectMp4StartInput {
	/** `<video>` 当前 src 属性值（从未设过为 null） */
	currentSrc: string | null;
	targetUrl: string;
	/** 元素已进入错误态（`video.error` 非空），不复位就再也拉不回流 */
	elementHasError: boolean;
	/** 上一次播放尝试已判失败（`playbackStatus === "failed"`） */
	previousAttemptFailed: boolean;
}

/**
 * mp4 直链播放前如何准备 `<video>`。
 *
 * 起因（用户症状）："重新播放"从未成功过，只有"重新加载预览"才放得出来。
 * 根因：预取优化（5a4ccac）看到 src 已是同一地址就跳过赋值，而失败后的 `<video>`
 * 停在错误态（`networkState = NETWORK_NO_SOURCE`）：`play()` 只在 networkState 为
 * NETWORK_EMPTY 时才重新走资源选择算法，所以同一个坏元素永远拉不回流——每次要么
 * 立刻 NotSupportedError，要么 20s 超时再次判失败。"重新加载预览"之所以有效，
 * 正是因为 resolveCurrentCode 用 `removeAttribute("src") + load()` 复位了元素。
 *
 * 因此：地址不同 → 赋值（赋值本身触发加载算法并清掉 error）；地址相同且元素不可用
 * → 显式 `load()` 复位；只有"预取完好且从未失败"这条热路径才保留已缓冲的 moov。
 */
export function planDirectMp4Start({
	currentSrc,
	targetUrl,
	elementHasError,
	previousAttemptFailed,
}: DirectMp4StartInput): DirectMp4StartPlan {
	if (currentSrc !== targetUrl) return { assignSrc: true, reload: false };
	if (elementHasError || previousAttemptFailed) {
		return { assignSrc: false, reload: true };
	}
	return { assignSrc: false, reload: false };
}

/** 回退链的一个候选档 */
export type FallbackStageCandidate =
	/** JavTrailers 详情页兜底（mgstage），只有封面方是 javtrailers 时才有这一层 */
	| { kind: "detail" }
	/** `media.fallbackTiers[index]`（解析期已取到，0 请求） */
	| { kind: "tier"; index: number };

/**
 * 计算播放/封面回退链的**下一个**候选档（纯函数，便于单测钉住顺序与终止条件）。
 *
 * 游标口径：`0` = 主媒体已试；`1` = 详情页兜底已试；`N≥2` = `fallbackTiers[N-2]` 已试。
 * 顺序固定为「主媒体 → 详情页兜底 → fallbackTiers 逐档」，返回 `null` 表示档位用尽（判失败）。
 *
 * 为什么详情页兜底只对 javtrailers 封面方开：那一层抓的是 `javtrailers.com/ja/video/{contentId}`
 * 详情页里的 mgstage 资产，封面方不是 javtrailers 时根本没有 JT contentId 可抓（faleno / dmm
 * 的号在 javtrailers 上没有对应页），硬试只会白等一次请求。
 */
export function nextFallbackStage(
	stage: number,
	coverSource: PreviewLookupSource | null,
	tierCount: number,
): FallbackStageCandidate | null {
	if (stage === 0 && coverSource === "javtrailers") return { kind: "detail" };
	// 游标 0 与 1 之后都从第一档开始；2 之后接续
	const index = stage <= 1 ? 0 : stage - 1;
	if (index < tierCount) return { kind: "tier", index };
	return null;
}

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
		type: "loadeddata",
		listener: () => void,
		options: { once: true },
	): void;
	/**
	 * 可选（Chrome/Safari 支持）：回调在**新帧提交到合成器**时触发，是唯一能保证
	 * "画面已经画出来了"的信号。`playing` / `play()` 的 promise 都早于首帧绘制。
	 */
	requestVideoFrameCallback?: (callback: () => void) => number;
}

export interface FirstFrameOptions {
	timeoutMs?: number;
	onTimeout?: () => void;
}

/**
 * 有画面了才进入播放态。
 *
 * 起因（用户症状）：原先 `video.play().then(() => 显示 video)` —— `play()` 在首帧绘制之前
 * 就 resolve，`<video controls>` 一显示，浏览器先画自己的半透明中央播放按钮，直到首帧到达
 * 才消失，看起来就是"播放按钮卡住"。
 *
 * 信号选择（两轮实测教训）：
 * - `playing` **不能用**：它同样早于首帧绘制，切过去就是黑底 + 原生控件；
 * - 只等 `loadeddata` 也不行：`<video>` 若 `display:none`，Chromium 会暂停解码，该事件永远不来；
 * - 因此：调用方保证 video 处于渲染状态 + 这里用 `requestVideoFrameCallback`（首帧提交到
 *   合成器）为主信号，`loadeddata` 为兜底，另加超时上限。
 *
 * 重播场景元素已有帧数据，`loadeddata` 不会再触发，故先判 readyState 立即切。
 *
 * @returns true = 已立即就绪；false = 已挂好信号（可能含超时定时器）
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
	video.requestVideoFrameCallback?.(fire);

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

/** 预览源切换控件的一档：主档，或解析期已取到的后备档（切换时 0 额外请求） */
export interface PreviewChoice {
	/** "primary" 或 "tier-<index>" */
	key: string;
	/** 主档为 null；后备档为 media.fallbackTiers 下标 */
	tierIndex: number | null;
	source: PreviewLookupSource;
	previewUrl: string;
	/** true = mp4 直链；false = 走 hls.js（由来源谓词判定，后备档没有 previewType 字段） */
	directMp4: boolean;
}

/**
 * 列出可切换的预览档：主档 + 有预告地址的后备档，顺序即控件顺序。
 *
 * 主档没有预告地址时也允许只剩后备档 —— 否则解析期取到的 DMM mp4 会因为 JT 缺片而完全播不了。
 * 少于 2 档时调用方不渲染控件。封面不随档切换，故这里不取 coverUrl。
 */
export function buildPreviewChoices(media: PreviewMedia | null): PreviewChoice[] {
	if (!media) return [];
	const choices: PreviewChoice[] = [];
	if (media.previewUrl) {
		choices.push({
			key: "primary",
			tierIndex: null,
			source: media.source,
			previewUrl: media.previewUrl,
			directMp4: isDirectMp4Source(media.source),
		});
	}
	(media.fallbackTiers ?? []).forEach((tier, index) => {
		if (!tier.previewUrl) return;
		choices.push({
			key: `tier-${index}`,
			tierIndex: index,
			source: tier.source,
			previewUrl: tier.previewUrl,
			directMp4: isDirectMp4Source(tier.source),
		});
	});
	return choices;
}

/**
 * 按用户上次选的档位挑默认档：偏好 2 且本次确实有第 2 档才优先，
 * 否则一律第 1 档 —— 只有一档或偏好值异常时都不会选中不存在的档。
 */
export function pickDefaultPreviewChoice(
	choices: PreviewChoice[],
	preferredSlot: number,
): PreviewChoice | null {
	const second = preferredSlot === 2 ? choices[1] : undefined;
	return second ?? choices[0] ?? null;
}

export type PlaybackStage =
	| { kind: "primary" }
	| { kind: "detail" }
	| { kind: "tier"; index: number };

export interface PlaybackFallbackOrderInput {
	coverSource: PreviewLookupSource | null;
	/** 有预告地址的后备档下标，保持 fallbackTiers 原序 */
	playableTierIndexes: number[];
	/** 本次播放起步的后备档下标；null = 由主档起步 */
	startTierIndex: number | null;
}

/**
 * 生成「起步档播放失败后」依次尝试的候选档。
 *
 * 原链是单向的「主档 → 详情页兜底 → 后备档」：手动选中后备档后，游标已到链尾，
 * 失败会直接判 failed 而回不到 JT。因此手动起步的档失败后重排为
 * 「回主档 → 详情页兜底 → 其余后备档」，并跳过已试过的那一档，避免原地打转。
 * 详情页兜底只有 javtrailers 封面方才有（要抓 JT 详情页的 mgstage 资产）。
 */
export function buildPlaybackFallbackOrder({
	coverSource,
	playableTierIndexes,
	startTierIndex,
}: PlaybackFallbackOrderInput): PlaybackStage[] {
	const detail: PlaybackStage[] =
		coverSource === "javtrailers" ? [{ kind: "detail" }] : [];
	const tierStages = (indexes: number[]): PlaybackStage[] =>
		indexes.map((index) => ({ kind: "tier", index }));

	if (startTierIndex === null) return [...detail, ...tierStages(playableTierIndexes)];
	return [
		{ kind: "primary" },
		...detail,
		...tierStages(
			playableTierIndexes.filter((index) => index !== startTierIndex),
		),
	];
}
