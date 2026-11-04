import React, { useCallback, useEffect, useRef, useState } from "react";
import type { DetailPageFallback } from "../../../src/lib/javtrailers";
import {
	destroyHlsBefore,
	destroyHlsInstance,
} from "../../../src/lib/hls-instance";
import {
	PLAYBACK_LOAD_TIMEOUT_MS,
	armPlayingOnFirstFrame,
	buildPlaybackFallbackOrder,
	buildPreviewChoices,
	getPreviewPresentation,
	nextFallbackStage,
	pickDefaultPreviewChoice,
	planDirectMp4Start,
	transitionPreviewNotice,
	type PlaybackStage,
	type PreviewChoice,
} from "../../../src/lib/preview-state";
import {
	canUseTitleAsShortTitle,
	sourceLabelKey,
} from "../../../src/lib/preview-source";
import {
	buildGoogleVerifyUrl,
	buildMergedTranslateText,
	splitMergedTranslation,
} from "../../../src/lib/translate";
import { mapWithConcurrency } from "../../../src/lib/concurrency";
import {
	PERFORMER_TRANSLATE_CONCURRENCY,
	buildMetaRow,
} from "../../../src/lib/preview-meta";
import type { LocaleMessages } from "../../../src/lib/locales";
import { toExternalSearchCode } from "../../../src/lib/normalize-code";
import {
	configuredPlatforms,
	getPreferredPreviewSlot,
	getSettings,
	platformInitial,
	resolveSearchUrl,
	savePreferredPreviewSlot,
} from "../../../src/lib/settings";
import type {
	PreviewLookupError,
	PreviewLookupSource,
	PreviewMedia,
	PreviewResolution,
	SupportedLocale,
} from "../../../src/lib/types";
import { EmbyBadge } from "./EmbyBadge";
import { FavoriteIcon } from "./FavoriteIcon";

interface TrailerPreviewProps {
	code: string;
	locale: SupportedLocale;
	t: LocaleMessages;
	onClose: () => void;
	isFavorite: boolean;
	onToggleFavorite: () => void;
	inLibrary: boolean;
}

type PlayerStatus = "idle" | "loading" | "playing" | "failed";
type ResolutionState = PreviewResolution | { status: "loading" };

export const TrailerPreview: React.FC<TrailerPreviewProps> = ({
	code,
	locale,
	t,
	onClose,
	isFavorite,
	onToggleFavorite,
	inLibrary,
}) => {
	const [coverError, setCoverError] = useState(false);
	// 主媒体 404 时从详情页兜底的备用媒体（null = 未拉取；对象 = 已拉取，字段可为 null）
	const [fallbackMedia, setFallbackMedia] = useState<DetailPageFallback | null>(null);
	// 当前封面 src：空 = 用主封面；加载失败后切换为备用封面
	const [coverSrc, setCoverSrc] = useState("");
	// 封面加载中：隐藏 img 与 broken 占位，显示 spinner 直到图片就绪
	const [coverLoading, setCoverLoading] = useState(false);
	const [status, setStatus] = useState<PlayerStatus>("idle");
	const [noticeDismissed, setNoticeDismissed] = useState(false);
	// 实际在播的来源：主媒体起步，每切一档回退就更新 → 「xxx源播放失败」文案取它
	const [playSource, setPlaySource] = useState<PreviewLookupSource | null>(null);
	// 本次手动选中的预览档；null = 跟随记忆的档位偏好。只影响视频，封面不随档切换
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	// 记住的档位（1 = 第 1 档，2 = 第 2 档）：只在本次没有手动选择时决定默认档
	const [preferredSlot, setPreferredSlot] = useState(getPreferredPreviewSlot);
	// 标题/介绍区展开态：收起 90px 截断，展开 250px 浮在番号列表之上
	const [titleExpanded, setTitleExpanded] = useState(false);
	// 标题译文（拼装翻译后拆分还原：标题译文 + 介绍译文；失败或英文界面保持 null）
	const [translatedShort, setTranslatedShort] = useState<string | null>(null);
	const [translatedLong, setTranslatedLong] = useState<string | null>(null);
	// 出演者译文映射：原名 → 译文（原名做键，天然去重）。未就绪或失败时回退原名
	const [performerTranslations, setPerformerTranslations] = useState<
		Record<string, string>
	>({});
	// 标题显示就绪：翻译流程结束（成功/失败）或英文界面直接跳过。期间不渲染标题区，避免原文→译文的闪烁
	const [titleReady, setTitleReady] = useState(false);
	// 手动重试翻译进行中
	const [retrying, setRetrying] = useState(false);
	// 谷歌限流需要人工验证（打开验证页完成 reCAPTCHA 后自动重试）
	const [needsVerify, setNeedsVerify] = useState(false);
	// 翻译错误信息区：每行一条（Worker 失败原因 + 备用服务失败原因）；google-verify 不占用错误行
	const [translateErrors, setTranslateErrors] = useState<string[] | null>(null);
	// 验证弹窗的窗口 id（关闭时触发自动重试）
	const verifyWinIdRef = useRef<number | null>(null);

	// 请求翻译并返回译文与错误码（translated 空 = 失败）；Worker 配置从设置读取随消息携带。
	// workerError：Worker 失败原因（错误码+文案），即使谷歌兜底成功也会带回供错误行提示。
	// 全程静默：翻译链路不向控制台输出任何异常
	const requestTranslate = async (
		text: string,
	): Promise<{ translated: string; error?: string; workerError?: string }> => {
		const s = getSettings();
		const res = (await browser.runtime.sendMessage({
			type: "jt:translate",
			text,
			target: locale === "zh-hant" ? "zh-TW" : "zh-CN",
			deeplKey: s.deeplApiKey,
			translateUrl: s.translateApiUrl,
			translateEnabled: s.translateEnabled,
			fallbackService: s.fallbackService,
		})) as
			| { translated?: string; error?: string; workerError?: string }
			| undefined;
		return {
			translated: res?.translated || "",
			error: res?.error,
			workerError: res?.workerError,
		};
	};

	// 翻译结果应用到状态：拼装翻译时按 <code> 保护标记（翻译后还原为花括号）拆分标题/介绍译文；
	// javtrailers 源无拼装（卡片标题即标题），译文放标题行
	const applyTranslation = (result: {
		translated: string;
		error?: string;
		workerError?: string;
	}) => {
		setNeedsVerify(false);
		if (result.translated) {
			if (media?.shortTitle) {
				// dmm 源：拼装翻译，拆不出时整体作为介绍译文
				const split = splitMergedTranslation(result.translated);
				setTranslatedShort(split.short);
				setTranslatedLong(split.long);
			} else {
				// javtrailers 源：译文即标题译文
				setTranslatedShort(result.translated);
				setTranslatedLong(null);
			}
			// 兜底成功时也显示 Worker 失败原因（提示主翻译服务异常）
			setTranslateErrors(result.workerError ? [result.workerError] : null);
			return true;
		}
		if (result.error === "google-verify") {
			setNeedsVerify(true);
			setTranslateErrors(result.workerError ? [result.workerError] : null);
		} else {
			const errors = [result.workerError, result.error].filter(
				(x): x is string => Boolean(x),
			);
			setTranslateErrors(errors.length ? errors : null);
		}
		return false;
	};
	// 通过 background 解析到的媒体信息（dmm 优先命中或 javtrailers 兜底）
	const [resolution, setResolution] = useState<ResolutionState>({
		status: "loading",
	});
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const hlsRef = useRef<{ destroy(): void } | null>(null);
	const rootRef = useRef<HTMLElement | null>(null);
	const resolutionRequestRef = useRef(0);
	const playbackRequestRef = useRef(0);
	const videoPlaybackRequestRef = useRef(0);
	// 播放失败后的候选档序列与游标：由 buildPlaybackFallbackOrder 按"起步档"重排，
	// 手动选后备档失败时才能回到主档，而不是停在单向链尾直接判失败
	const fallbackOrderRef = useRef<PlaybackStage[]>([]);
	const fallbackIndexRef = useRef(0);
	// 每次"开始某一档"自增；失败信号带上它，才能把上一档迟到的 error 判成过期
	const playAttemptRef = useRef(0);
	// 已处理过失败的 attempt 号：同一档常同时收到 onError 与 play() rejection，只推进一次
	const failureHandledRef = useRef(0);
	// 封面回退游标：0 = 主封面、1 = 详情页兜底、N≥2 = fallbackTiers[N-2]（与播放链独立）
	const coverStageRef = useRef(0);

	// 挂载时把预览卡片滚动到可视区域顶部（列表较长时点击番号可能看不见预览）
	useEffect(() => {
		rootRef.current?.scrollIntoView({ block: "start" });
	}, []);

	const media: PreviewMedia | null =
		resolution.status === "resolved" ? resolution.media : null;
	const coverUrl = media?.coverUrl || "";
	// 可切换的预览档全部来自解析期结果（0 额外请求）；少于 2 档时控件不渲染
	const choices = buildPreviewChoices(media);
	// 手动选过就用手动的；否则按记忆档位挑默认档（只有一档时自动回落第 1 档）
	const activeChoice =
		choices.find((choice) => choice.key === selectedKey) ??
		pickDefaultPreviewChoice(choices, preferredSlot);
	const primaryChoice =
		choices.find((choice) => choice.key === "primary") ?? null;

	// 预取元数据：实测首帧总耗时 ~7 s，其中 6.9 s 花在"连接 + moov"上
	// （loadedmetadata 6.911 s → rvfc 7.025 s，只差 0.11 s）。
	// 解析出地址就提前设 src + preload="metadata"，把这 6.9 s 从"点击后"挪到"看封面时"，
	// 点击后基本只剩解码首帧。只预取主档 mp4 直链：后备档等用户切过去再拉，
	// 避免为了"可能不看"的第二套视频提前打日本源站。
	const primaryUrl = primaryChoice?.directMp4 ? primaryChoice.previewUrl : null;
	useEffect(() => {
		const video = videoRef.current;
		if (!video || !primaryUrl) return;
		// 同一地址不重复触发，否则会把已开始的加载白重下一遍
		if (video.getAttribute("src") === primaryUrl) return;
		video.preload = "metadata";
		video.src = primaryUrl;
	}, [primaryUrl]);

	const resolveCurrentCode = useCallback(async () => {
		const requestId = ++resolutionRequestRef.current;
		playbackRequestRef.current++;
		destroyHlsInstance(hlsRef);
		videoRef.current?.pause();
		videoRef.current?.removeAttribute("src");
		videoRef.current?.load();
		setResolution({ status: "loading" });
		setStatus("idle");
		setFallbackMedia(null);
		setCoverError(false);
		setCoverSrc("");
		setCoverLoading(false);
		setPlaySource(null);
		setSelectedKey(null);
		setTitleExpanded(false);
		// 重新打开番号时以存储里的最新偏好为准（用户可能在别的面板里改过）
		setPreferredSlot(getPreferredPreviewSlot());
		fallbackOrderRef.current = [];
		fallbackIndexRef.current = 0;
		playAttemptRef.current = 0;
		failureHandledRef.current = 0;
		coverStageRef.current = 0;
		setNoticeDismissed((dismissed) =>
			transitionPreviewNotice(dismissed, "lookup_retry"),
		);
		setTranslatedShort(null);
		setTranslatedLong(null);
		setPerformerTranslations({});
		setTitleReady(false);
		setNeedsVerify(false);
		setRetrying(false);
		setTranslateErrors(null);

		try {
			const settings = getSettings();
			const response = (await browser.runtime.sendMessage({
				type: "jt:resolve-detail",
				code,
				lookupEnabled: settings.lookupEnabled,
				apiUrl: settings.apiUrl,
				apiKey: settings.apiKey,
				falenoPrefixes: settings.falenoPrefixes,
			})) as PreviewResolution | undefined;
			if (requestId !== resolutionRequestRef.current) return;
			setResolution(
				response ?? {
					status: "error",
					media: null,
					errors: [{ source: "javtrailers", kind: "network" }],
				},
			);
		} catch {
			if (requestId !== resolutionRequestRef.current) return;
			setResolution({
				status: "error",
				media: null,
				errors: [{ source: "javtrailers", kind: "network" }],
			});
		}
	}, [code]);

	useEffect(() => {
		void resolveCurrentCode();
		return () => {
			resolutionRequestRef.current++;
			playbackRequestRef.current++;
			destroyHlsInstance(hlsRef);
		};
	}, [resolveCurrentCode]);

	// 解析到 Content ID 后封面 URL 变化，重置失败状态与封面 src 以重新尝试
	useEffect(() => {
		setCoverError(false);
		setCoverSrc("");
		setCoverLoading(false);
		coverStageRef.current = 0;
	}, [coverUrl]);

	// 中文/繁中界面下翻译标题；英文界面不翻译。失败保持 null（回退原文）
	// 标题与介绍拼装一次发送（标题 <code> 标签保护标记），返回后还原拆分
	useEffect(() => {
		// 闭包内 property narrowing 不保留，取局部常量
		const title = media?.title;
		if (!title) return;
		const shortTitle = media?.shortTitle;
		if (locale === "en") {
			setTitleReady(true);
			return;
		}
		setTitleReady(false);
		let disposed = false;
		void (async () => {
			try {
				const translateInput = shortTitle
					? buildMergedTranslateText(shortTitle, title)
					: title;
				const result = await requestTranslate(translateInput);
				if (!disposed) {
					applyTranslation(result);
					setTitleReady(true);
				}
			} catch {
				// 翻译失败：保持 null，标题区显示原文 + 重试图标
				if (!disposed) {
					setTitleReady(true);
				}
			}
		})();
		return () => {
			disposed = true;
		};
	}, [media?.title, media?.shortTitle, locale]);

	// 出演者逐名翻译：**每个名字单独请求**，才能吃到 Worker 的 KV 缓存（同一出演者跨作品复用）。
	// 失败静默保留原名 —— 绝不触碰标题那套错误/验证状态（translateErrors / needsVerify / 验证窗）。
	useEffect(() => {
		const names = media?.performers ?? [];
		if (names.length === 0 || locale === "en") return;
		let disposed = false;
		void mapWithConcurrency(
			[...new Set(names)],
			PERFORMER_TRANSLATE_CONCURRENCY,
			async (name) => {
				try {
					const result = await requestTranslate(name);
					if (disposed || !result.translated) return;
					setPerformerTranslations((previous) =>
						previous[name] === result.translated
							? previous
							: { ...previous, [name]: result.translated },
					);
				} catch {
					// 静默：保留原名
				}
			},
		);
		return () => {
			disposed = true;
		};
	}, [media?.performers, locale]);

	// 翻译失败后手动重试（验证窗口关闭后也自动调用）
	const handleRetryTranslate = async () => {
		const title = media?.title;
		if (!title || retrying) return;
		setRetrying(true);
		try {
			const translateInput = media?.shortTitle
				? buildMergedTranslateText(media.shortTitle, title)
				: title;
			const result = await requestTranslate(translateInput);
			applyTranslation(result);
		} catch {
			// 保持失败状态，图标仍在可再次点击
		} finally {
			setRetrying(false);
		}
	};

	// 打开谷歌验证小窗口：直接加载带标题文本的 gtx 完整 URL——
	// 该 URL 在浏览器中会触发谷歌的验证页（translate.google.com 首页则不会）
	const openVerifyWindow = async (text: string) => {
		try {
			const win = await browser.windows.create({
				url: buildGoogleVerifyUrl(
					text,
					locale === "zh-hant" ? "zh-TW" : "zh-CN",
				),
				type: "popup",
				width: 420,
				height: 640,
			});
			verifyWinIdRef.current = win?.id ?? null;
		} catch {
		// 创建窗口失败：用户仍可点手动重试
		}
	};

	// 验证窗口关闭视为验证完成，自动重试一次翻译
	useEffect(() => {
		if (typeof browser === "undefined" || !browser.windows?.onRemoved) return;
		const handleRemoved = (windowId: number) => {
			if (verifyWinIdRef.current !== windowId) return;
			verifyWinIdRef.current = null;
			void handleRetryTranslate();
		};
		browser.windows.onRemoved.addListener(handleRemoved);
		return () => {
			browser.windows.onRemoved.removeListener(handleRemoved);
		};
	}, []);

	// 拉取详情页备用媒体；每个番号只拉一次（结果含 null 也缓存，不重复请求）
	const requestFallback = async (
		contentId: string | null,
		requestId: number,
	): Promise<DetailPageFallback> => {
		if (fallbackMedia) return fallbackMedia;
		if (!contentId) return { coverUrl: null, trailerUrl: null };
		let result: DetailPageFallback = { coverUrl: null, trailerUrl: null };
		try {
			const res = (await browser.runtime.sendMessage({
				type: "jt:resolve-fallback",
				contentId,
			})) as DetailPageFallback | undefined;
			if (res) result = res;
		} catch {
			// 拉取失败保持空兜底
		}
		if (requestId === resolutionRequestRef.current) setFallbackMedia(result);
		return result;
	};

	// 封面加载失败：按「详情页兜底（mgstage）→ media.fallbackTiers 逐档」推进。
	// 档位顺序与"哪些源有详情页兜底"由 nextFallbackStage（preview-state.ts）决定 —— 那里有一处
	// `coverSource === "javtrailers"` 的来源硬编码，理由见该函数注释：详情页兜底抓的是
	// javtrailers 详情页里的 mgstage 资产，封面方不是 javtrailers 时根本没有 JT contentId 可抓。
	const handleCoverError = () => {
		const requestId = resolutionRequestRef.current;
		const tiers = media?.fallbackTiers ?? [];
		void (async () => {
			// 与播放共用同一套档位规则（nextFallbackStage）：详情页兜底 → 后备档逐档
			while (true) {
				const next = nextFallbackStage(
					coverStageRef.current,
					media?.source ?? null,
					tiers.length,
				);
				if (!next) {
					// 档位用尽：进入失败态，不无限重试
					setCoverLoading(false);
					setCoverError(true);
					return;
				}
				if (next.kind === "detail") {
					coverStageRef.current = 1;
					setCoverLoading(true);
					const fb = await requestFallback(media?.contentId ?? null, requestId);
					if (requestId !== resolutionRequestRef.current) return;
					if (fb.coverUrl) {
						// 备用图加载完成后由 onLoad 恢复显示
						setCoverSrc(fb.coverUrl);
						return;
					}
					continue;
				}
				coverStageRef.current = next.index + 2;
				const tier = tiers[next.index];
				// 后备档：解析期已取到的第二路，这里只换 src，不再发查询
				if (!tier?.coverUrl) continue;
				setCoverLoading(true);
				setCoverSrc(tier.coverUrl);
				return;
			}
		})();
	};

	// 播放链推进：按 buildPlaybackFallbackOrder 生成的序列逐档尝试。
	// 每档必须等到失败信号才推进，任一档成功即停；序列用尽才真正判 failed。
	// 红线：后备档只能复用解析期已取到的 choices 字段，**不得在此处再发起 FALENO/DMM 查询**。
	// 这几层互相调用（失败推进下一档、下一档再失败又回推进），用 function 声明靠提升打通前向引用
	async function advancePlayback(requestId: number) {
		const video = videoRef.current;
		if (!video || requestId !== playbackRequestRef.current) return;

		while (true) {
			const stage = fallbackOrderRef.current[fallbackIndexRef.current];
			if (!stage) {
				setStatus("failed");
				return;
			}
			fallbackIndexRef.current++;
			if (stage.kind === "primary") {
				if (!primaryChoice) continue;
				startChoicePlayback(video, primaryChoice, requestId);
				return;
			}
			if (stage.kind === "detail") {
				const fb = await destroyHlsBefore(hlsRef, () =>
					requestFallback(media?.contentId ?? null, resolutionRequestRef.current),
				);
				if (requestId !== playbackRequestRef.current) return;
				if (fb.trailerUrl) {
					// mgstage 仍属 JavTrailers 这条链路，来源标签不换
					startChoicePlayback(
						video,
						{
							source: "javtrailers",
							previewUrl: fb.trailerUrl,
							directMp4: true,
						},
						requestId,
					);
					return;
				}
				continue;
			}
			const tierChoice = choices.find(
				(choice) => choice.tierIndex === stage.index,
			);
			if (!tierChoice) continue;
			startChoicePlayback(video, tierChoice, requestId);
			return;
		}
	}

	// 某一档播放失败：同一档可能同时收到 onError 与 play() rejection，带上 attempt 去重；
	// 上一档迟到的 error 因 attempt 已过期而被忽略，不会多跳一档。
	function failPlayback(requestId: number, attempt: number) {
		if (requestId !== playbackRequestRef.current) return;
		if (attempt !== playAttemptRef.current) return;
		if (failureHandledRef.current === attempt) return;
		failureHandledRef.current = attempt;
		void advancePlayback(requestId);
	}

	// 所有播放起点统一入口：首帧就绪才切 playing（避免原生中央播放按钮闪出），
	// 超时未就绪则推进下一档（用尽后由 advancePlayback 判 failed）—— 不会让 loading 无限转下去。
	function startPlayback(video: HTMLVideoElement, requestId: number, attempt: number) {
		armPlayingOnFirstFrame(
			video,
			() => {
				if (requestId === playbackRequestRef.current) setStatus("playing");
			},
			{
				timeoutMs: PLAYBACK_LOAD_TIMEOUT_MS,
				onTimeout: () => failPlayback(requestId, attempt),
			},
		);
	}

	// 准备 `<video>` 播放 mp4 直链：预取完好就沿用（保住已缓冲的 moov），
	// 失败/错误态则 load() 复位重拉。直链与 HLS 404 兜底直链共用，
	// 避免两处各自漏掉复位 —— 那正是"重新播放"永远失败的根因（见 planDirectMp4Start）。
	const prepareDirectMp4 = (
		video: HTMLVideoElement,
		url: string,
		previousFailed: boolean,
	) => {
		const plan = planDirectMp4Start({
			currentSrc: video.getAttribute("src"),
			targetUrl: url,
			elementHasError: video.error !== null,
			previousAttemptFailed: previousFailed,
		});
		video.preload = "auto";
		if (plan.assignSrc) video.src = url;
		if (plan.reload) video.load();
	};

	/** 播放入口只关心地址 / 来源 / 是否直链，主档、后备档、详情页兜底共用 */
	type PlaybackChoice = Pick<
		PreviewChoice,
		"source" | "previewUrl" | "directMp4"
	>;

	// 开始播放某一档：新 attempt + 记录来源标签，供失败文案使用。
	// mp4 与 HLS 两条路径都收在这里，切档回到 JT 的 m3u8 才不会退化成 <video src="m3u8">。
	function startChoicePlayback(
		video: HTMLVideoElement,
		choice: PlaybackChoice,
		requestId: number,
	) {
		const attempt = ++playAttemptRef.current;
		setPlaySource(choice.source);
		setStatus("loading");
		destroyHlsInstance(hlsRef);

		if (choice.directMp4) {
			// 预取地址可用就沿用不重置（重置会丢掉已缓冲的 moov，白等一遍）；
			// 但同一地址 + 已失败/错误态必须 load() 复位，否则 play() 不会重新走资源选择，
			// <video> 卡在错误态里，"重新播放"就永远失败（只有"重新加载预览"能救）。
			prepareDirectMp4(video, choice.previewUrl, status === "failed");
			startPlayback(video, requestId, attempt);
			void video.play().catch(() => failPlayback(requestId, attempt));
			return;
		}

		void (async () => {
			try {
				// 懒加载 hls.js light 构建，仅首次播 HLS 时加载，不拖慢面板首开
				const { default: Hls } = await import("hls.js/light");
				if (requestId !== playbackRequestRef.current) return;
				if (Hls.isSupported()) {
					const hls = new Hls();
					hlsRef.current = hls;
					hls.loadSource(choice.previewUrl);
					hls.attachMedia(video);
					hls.on(Hls.Events.MANIFEST_PARSED, () => {
						if (requestId !== playbackRequestRef.current) return;
						startPlayback(video, requestId, attempt);
						// 处于用户点击手势内，不会被自动播放策略拦截
						void video.play().catch(() => {
							if (requestId !== playbackRequestRef.current) return;
							destroyHlsInstance(hlsRef);
							failPlayback(requestId, attempt);
						});
					});
					hls.on(Hls.Events.ERROR, (_event, data) => {
						if (requestId !== playbackRequestRef.current) return;
						if (!data.fatal) return;
						// 404 = 该番号无 HLS 预告片；其余（含 Firefox 上无 DNR 规则导致的 CORS 失败）
						// 同样按加载失败处理 —— 两者都推进回退序列。
						destroyHlsInstance(hlsRef);
						failPlayback(requestId, attempt);
					});
				} else if (video.canPlayType("application/vnd.apple.mpegurl")) {
					// Safari 原生支持 HLS，无需 hls.js
					video.src = choice.previewUrl;
					startPlayback(video, requestId, attempt);
					void video.play().catch(() => failPlayback(requestId, attempt));
				} else {
					setStatus("failed");
				}
			} catch {
				if (requestId === playbackRequestRef.current) setStatus("failed");
			}
		})();
	}

	// 一次播放的公共前置：作废旧请求、按起步档重建回退序列、应用音量。
	const beginPlayback = (choice: PreviewChoice) => {
		const video = videoRef.current;
		if (!video) return;
		setNoticeDismissed((dismissed) =>
			transitionPreviewNotice(dismissed, "playback_retry"),
		);
		const requestId = ++playbackRequestRef.current;
		videoPlaybackRequestRef.current = requestId;
		destroyHlsInstance(hlsRef);
		video.pause();
		fallbackOrderRef.current = buildPlaybackFallbackOrder({
			coverSource: media?.source ?? null,
			playableTierIndexes: choices
				.filter((item) => item.tierIndex !== null)
				.map((item) => item.tierIndex as number),
			startTierIndex: choice.tierIndex,
		});
		fallbackIndexRef.current = 0;
		failureHandledRef.current = 0;
		// 播放开始时应用设置中的预览音量（0-100 → 0-1）
		video.volume = getSettings().previewVolume / 100;
		startChoicePlayback(video, choice, requestId);
	};

	const handlePlay = () => {
		if (!activeChoice || status === "loading" || status === "playing") return;
		beginPlayback(activeChoice);
	};

	// 切换预览档：只换视频，封面与标题不动。播放中立即切播；未播放时仅预选。
	// 清理 <video> 前先作废旧播放请求，否则 load() 触发的 error 会被算到新档头上。
	const handleSelectChoice = (key: string) => {
		const index = choices.findIndex((item) => item.key === key);
		const choice = index >= 0 ? choices[index] : undefined;
		if (!choice) return;
		// 记「第几档」而不是具体来源：下次第二路换成 DMM 或 FALENO，仍能对上同一个按钮
		const slot = index === 1 ? 2 : 1;
		savePreferredPreviewSlot(slot);
		setPreferredSlot(slot);
		if (choice.key === activeChoice?.key) return;
		const wasPlaying = status === "playing" || status === "loading";
		setSelectedKey(choice.key);
		playbackRequestRef.current++;
		destroyHlsInstance(hlsRef);
		const video = videoRef.current;
		if (video) {
			video.pause();
			video.removeAttribute("src");
			video.load();
		}
		fallbackOrderRef.current = [];
		fallbackIndexRef.current = 0;
		failureHandledRef.current = 0;
		if (wasPlaying) {
			beginPlayback(choice);
		} else {
			setStatus("idle");
			setPlaySource(null);
		}
	};

	const handleReload = () => void resolveCurrentCode();

	const handleClose = () => {
		destroyHlsInstance(hlsRef);
		onClose();
	};

	// 头部的外部平台跳转按钮：显示规则与番号列表区共用 configuredPlatforms
	// （名称 + 链接规则都配置才出现），正文取平台名首字符做成方形按钮。
	// 跳转码用 toExternalSearchCode：FC2 番号外部平台只认 FC2-PPV-<数字> 写法。
	const platforms = configuredPlatforms(getSettings());
	const externalSearchCode = toExternalSearchCode(code);

	// 标题行（金色）：优先 media.shortTitle（dmm / d2pass 的 short_title 就是标题），
	// 否则按 canUseTitleAsShortTitle 用 title 兜底（javtrailers / faleno / fc2 没有独立标题字段）；
	// 介绍行（灰色）：以 shortTitle 是否存在为开关 —— 有独立标题的源（dmm / d2pass）在这里显示作品介绍。
	// 来源判定统一走 preview-source.ts，避免新增源漏登记。
	const displayShortTitle =
		media?.shortTitle ||
		(media && canUseTitleAsShortTitle(media.source) ? media.title : null);
	const displayLongTitle = media?.shortTitle ? media.title : null;
	const presentation = getPreviewPresentation({
		resolution,
		playbackStatus: status,
		hasCover: Boolean(media?.coverUrl) && !coverError,
		hasTrailer: Boolean(activeChoice),
		noticeDismissed,
	});
	// 封面底部浮条：左出演者（逐名译文）、右发布日；点播放后随 status 一起消失。
	// 注意用"封面层在渲染"而不是"有封面地址"：源站没给封面时（老 caribbeancom 号）
	// 面板仍渲染封面层（黑底 + 播放按钮），此时出演者/日期照样要显示。
	const coverLayerVisible =
		Boolean(media) && !presentation.mediaMessage && !coverError;
	const meta = buildMetaRow({
		playbackStatus: status,
		coverLayerVisible,
		performers: media?.performers ?? [],
		translations: performerTranslations,
		releaseDate: media?.releaseDate ?? null,
	});
	const formatLookupError = (error: PreviewLookupError) => {
		const sourceLabel = t[sourceLabelKey(error.source)];
		const code = error.code === undefined ? "" : String(error.code);
		const detail =
			error.kind === "timeout"
				? t.timeoutError
				: error.kind === "network"
					? t.networkError
				: error.message?.trim()
					? `${code ? `${code}: ` : ""}${error.message.trim()}`
					: error.error?.trim()
						? `${code ? `${code}: ` : ""}${error.error.trim()}`
						: error.status
							? `HTTP ${error.status}`
							: error.kind === "api"
								? t.abnormalResponse
								: t.networkError;
		return `${t.sourceErrorPrefix}${sourceLabel} ${detail}`;
	};
	// 播放失败文案带来源：「JavTrailers源播放失败」/「FALENO源播放失败」。
	// 取"实际在播的源"（playSource 随回退档位更新），未播放过则退回封面方。
	// 「来源标签有条件显示」即：只有播放失败这一种条件下才把来源写进文案，常态不显示。
	const playbackFailedText = t.playbackFailedBySource(
		t[sourceLabelKey(playSource ?? media?.source ?? "javtrailers")],
	);
	const noticeText = presentation.notices
		.map((notice) => {
			switch (notice.key) {
				case "lookup_error":
					return notice.errors.length
						? notice.errors.map(formatLookupError).join(" · ")
						: `${t.sourceErrorPrefix}${t.abnormalResponse}`;
				case "used_fallback":
					return t.usedFallback;
				case "no_trailer":
					return t.noTrailer;
				case "playback_error":
					return playbackFailedText;
			}
		})
		.filter(Boolean)
		.join(" · ");
	const retryActions: ("lookup" | "playback")[] =
		presentation.retryAction?.type === "multiple"
			? presentation.retryAction.actions
			: presentation.retryAction
				? [presentation.retryAction.type]
				: [];

	// 标题文本渲染：连续换行压缩为单个（删除空行），<br> 转成元素换行
	// （DMM 的介绍文与翻译结果都可能含 <br> 或连续 \n）
	const renderTitleText = (text: string) => {
		const collapsed = text.replace(/\n+/g, "\n").replace(/^\n+|\n+$/g, "");
		const parts = collapsed.split(/<br\s*\/?>/i);
		return parts.map((part, i) => (
			<React.Fragment key={i}>
				{i > 0 && <br />}
				{part}
			</React.Fragment>
		));
	};

	return (
		<section
			ref={rootRef}
			className="trailer-preview"
			aria-label={`${t.previewTitle}: ${code}`}
		>
			<header className="trailer-preview__header">
				<h3 className="trailer-preview__title">
					{t.previewTitle}{" "}
					<span className="trailer-preview__code-wrap">
						<span
							className="trailer-preview__code"
							onClick={handleReload}
							title={t.reloadPreview}
							role="button"
							tabIndex={0}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									handleReload();
								}
							}}
						>
							{code}
						</span>
					</span>
					<button
						type="button"
						className="trailer-preview__fav"
						onClick={onToggleFavorite}
						title={isFavorite ? t.removeFavorite : t.addFavorite}
						aria-label={isFavorite ? t.removeFavorite : t.addFavorite}
					>
						<FavoriteIcon active={isFavorite} />
					</button>
					{inLibrary && (
						<span
							className="trailer-preview__in-library"
							role="img"
							title={t.embyInLibrary}
							aria-label={t.embyInLibrary}
						>
							<EmbyBadge />
						</span>
					)}
				</h3>
				{platforms.length > 0 && (
					<div className="trailer-preview__actions">
						{/* 外部平台跳转：方形按钮只放平台名首字符，全名与番号走 title/aria-label */}
						{platforms.map((platform) => {
							const label = `Search ${code} on ${platform.name}`;
							return (
								<a
									key={platform.key}
									className="trailer-preview__icon-btn"
									href={resolveSearchUrl(
										platform.template,
										externalSearchCode,
									)}
									target="_blank"
									rel="noopener noreferrer"
									title={label}
									aria-label={label}
								>
									{platformInitial(platform.name)}
								</a>
							);
						})}
					</div>
				)}
				<button
					type="button"
					className="trailer-preview__icon-btn trailer-preview__close"
					onClick={handleClose}
					title={t.closePreview}
					aria-label={t.closePreview}
				>
					&times;
				</button>
			</header>

			<div className="trailer-preview__media">
				{/* video 常驻 DOM，hls.js attachMedia 需要已挂载的元素；未播放时隐藏 */}
				<video
					ref={videoRef}
					className="trailer-preview__video"
					controls
					playsInline
					style={{
						// loading 期间也要参与渲染：Chromium 会暂停 display:none 的 <video> 解码，
						// 那样首帧信号永远不来（实测踩过）。此时画面被下面的封面层遮住。
						display:
							status === "playing" || status === "loading" ? "block" : "none",
						// notice 贴封面顶部：播放中出现横幅时把 video 下移一个横幅高度，
						// 高度同步减去 32px（二者相加正好是整高），否则横幅会盖住画面顶部
						height: status === "playing" && noticeText ? "calc(100% - 32px)" : undefined,
						marginTop: status === "playing" && noticeText ? "32px" : undefined,
					}}
					onError={() => {
						if (
							videoPlaybackRequestRef.current === playbackRequestRef.current &&
							(status === "playing" || status === "loading")
						) {
							// 当前档位播放失败 → 推进回退链（用尽才判 failed）
							failPlayback(playbackRequestRef.current, playAttemptRef.current);
						}
					}}
				/>
				{status !== "playing" && presentation.showSpinner && (
					<div className="trailer-preview__media-message" role="status">
						<span className="spinner" aria-hidden="true" />
					</div>
				)}
				{status !== "playing" &&
					!presentation.showSpinner &&
					// 加载中一律给 loading 反馈：封面加载失败时也不能让等待期一片空白
					(status !== "loading" && (presentation.mediaMessage || coverError) ? (
						<div className="trailer-preview__media-message" role="status">
							<span>
								{presentation.mediaMessage === "no_number_information"
									? t.noNumberInformation
									: presentation.mediaMessage === "playback_failed"
										? playbackFailedText
										: t.previewUnavailable}
							</span>
							{presentation.showPlaybackRetry && (
								<button
									type="button"
									className="trailer-preview__primary-retry"
									onClick={() => void handlePlay()}
									aria-label={t.playbackRetry}
								>
									{t.playbackRetry}
								</button>
							)}
						</div>
					) : media ? (
						<div className="trailer-preview__cover-layer">
							{presentation.showCover && (
								<>
									{coverLoading && (
										<span className="trailer-preview__loading" aria-hidden="true">
											<span className="spinner" />
										</span>
									)}
									<img
										src={coverSrc || coverUrl}
										alt={`${code} cover`}
										className="trailer-preview__cover"
										referrerPolicy="no-referrer"
										onLoad={() => setCoverLoading(false)}
										onError={handleCoverError}
										style={coverLoading ? { display: "none" } : undefined}
									/>
								</>
							)}
							{status === "loading" ? (
								// 实测首帧要 ~7 s（大 mp4 + 网关）：细环叠在满幅封面上几乎看不见，
								// 所以先压暗封面（--playback）再放转圈。不加文案。
								<span
									className="trailer-preview__loading trailer-preview__loading--playback"
									aria-hidden="true"
								>
									<span className="spinner" />
								</span>
							) : presentation.showPlayButton ? (
								<button
									type="button"
									className="trailer-preview__play-btn"
									onClick={handlePlay}
									aria-label={t.playTrailer}
								>
									<svg
										viewBox="0 0 24 24"
										fill="currentColor"
										width="22"
										height="22"
										aria-hidden="true"
									>
										<path stroke="none" d="M0 0h24v24H0z" fill="none" />
										<path d="M7 4v16l13 -8l-13 -8" />
									</svg>
								</button>
							) : null}
							{/* 封面底部浮条：左出演者（逐名译文，空格分隔）、右发布日（贴右）。
							    渲染条件由 buildMetaRow 决定：idle + 封面可见 + 至少一侧有数据 */}
							{meta.show && (
								<div className="trailer-preview__meta">
									<span
										className="trailer-preview__performers"
										title={meta.fullNames}
									>
										{meta.performersText}
									</span>
									{meta.releaseDate && (
										<span className="trailer-preview__release">
											{meta.releaseDate}
										</span>
									)}
								</div>
							)}
						</div>
					) : null)}
				{noticeText && (
					<div className="trailer-preview__notice" role="alert" aria-live="assertive">
						<span className="trailer-preview__notice-text" title={noticeText}>
							{noticeText}
						</span>
						{retryActions.map((action) => (
							<button
								key={action}
								type="button"
								className="trailer-preview__notice-action"
								onClick={() =>
									action === "lookup" ? void resolveCurrentCode() : void handlePlay()
								}
								aria-label={action === "lookup" ? t.lookupRetry : t.playbackRetry}
							>
								{action === "lookup" ? t.lookupRetry : t.playbackRetry}
							</button>
						))}
						<button
							type="button"
							className="settings-field__error-close trailer-preview__notice-close"
							onClick={() =>
								setNoticeDismissed((dismissed) =>
									transitionPreviewNotice(dismissed, "dismiss"),
								)
							}
							aria-label={t.closeError}
							title={t.closeError}
						>
							&times;
						</button>
					</div>
				)}
				{/* 预览源切换：浮在画面右上角，仅在解析期拿到两套及以上预告地址时出现。
				    notice 出现时由它盖住（z-index 更高），关掉 notice 即可继续切换。 */}
				{choices.length > 1 && (
					<div
						className="trailer-preview__source-switch"
						role="group"
						aria-label={t.switchPreviewSource}
					>
					{choices.map((choice, index) => (
						<button
							key={choice.key}
							type="button"
							className="trailer-preview__source-btn"
							aria-pressed={choice.key === activeChoice?.key}
							aria-label={t[sourceLabelKey(choice.source)]}
							title={t[sourceLabelKey(choice.source)]}
							onClick={() => handleSelectChoice(choice.key)}
						>
							{index + 1}
						</button>
					))}
					</div>
				)}
			</div>

			{(displayShortTitle || displayLongTitle) && (
				<div
					className={`trailer-preview__title-slot${
						titleExpanded ? " trailer-preview__title-slot--expanded" : ""
					}`}
				>
					<div className="trailer-preview__title-area">
						<div className="trailer-preview__title-content">
					{/* 标题行：金色（dmm 商品名 / javtrailers 卡片标题），解析到即显示；翻译完成后替换为译文 */}
					{displayShortTitle && (
						<p className="trailer-preview__title-short">
							{renderTitleText(translatedShort || displayShortTitle)}
						</p>
					)}
					{/* 介绍行：dmm / d2pass 这类 title 即作品介绍文的源，翻译流程结束后显示，避免原文→译文的闪烁 */}
					{displayLongTitle && titleReady && (
						<p className="trailer-preview__title-text">
							{renderTitleText(translatedLong || displayLongTitle || "")}
						</p>
					)}
					{/* 中文/繁中界面翻译失败时显示重试图标（标题/介绍行共用） */}
					{locale !== "en" && titleReady && !translatedShort && !translatedLong && (
						<button
							type="button"
							className="trailer-preview__translate-retry"
							onClick={handleRetryTranslate}
							disabled={retrying}
							title={t.retryTranslate}
							aria-label={t.retryTranslate}
						>
							{retrying ? (
								<span
									className="spinner spinner--small"
									aria-hidden="true"
								/>
							) : (
								<svg
									viewBox="0 0 1024 1024"
									fill="currentColor"
									width="13"
									height="13"
									aria-hidden="true"
								>
									<path d="M677.676657 294.6142c19.165116 57.5433 44.715939 102.2992 89.431879 147.0551 38.322239-38.3622 63.873063-89.5118 83.038178-147.0551h-172.470057z m-421.56861 319.685h166.076358l-83.038179-223.7795-83.038179 223.7795z" />
									<path d="M894.854661 0.504H128.353929C58.095158 0.504 0.607803 58.0473 0.607803 128.378v767.244c0 70.3307 57.487355 127.874 127.746126 127.874h766.500733c70.258771 0 127.746126-57.5433 127.746126-127.874V128.378c0-70.3307-51.101647-127.874-127.746126-127.874zM581.867062 825.2913c-12.771416 12.7874-25.550824 12.7874-38.322239 12.7874-6.3937 0-19.165116 0-25.550824-6.3937-6.3937-6.3937-12.779408 0-12.779408-6.3937s-6.385708-12.7874-12.771415-25.5748c-6.3937-12.7874-6.3937-19.1811-12.779408-31.9685l-25.542832-70.3307H230.557224L205.0064 767.748c-12.771416 25.5748-19.165116 44.7559-25.550824 57.5433-6.3937 12.7874-19.165116 12.7874-38.322239 12.7874-12.779408 0-25.550824-6.3937-38.330231-12.7874-12.771416-12.7874-19.157124-19.1811-19.157124-31.9685 0-6.3937 0-12.7874 6.385708-25.5748 6.3937-12.7874 6.3937-19.1811 12.771416-31.9685l140.525533-358.0472c6.3937-12.7874 6.3937-25.5748 12.779408-38.3622 6.385708-12.7874 12.771416-25.5748 19.157124-31.9685 6.3937-6.3937 12.779408-19.1811 25.550823-25.5748 12.779408-6.3937 25.550824-6.3937 38.330232-6.3937 12.771416 0 25.542832 0 38.322239 6.3937 12.771416 6.3937 19.165116 12.7874 25.550824 25.5748 6.385708 6.3937 12.771416 19.1811 19.157124 31.9685 6.3937 12.7874 12.779408 25.5748 19.165115 44.7559l140.525534 351.6535c12.771416 25.5748 19.165116 44.7559 19.165116 57.5433-6.3937 6.3937-12.779408 19.1811-19.165116 31.9685zM933.176901 575.937c-70.258771-25.5748-121.360418-57.5433-166.076358-95.9055-44.707947 44.7559-102.195302 76.7244-172.462065 95.9055l-19.157124-31.9685c70.258771-19.1811 127.746126-44.7559 172.462066-89.5118C703.22748 409.7008 664.905241 352.1575 652.125833 288.2205h-63.873063v-25.5748h172.470058c-12.7874-19.1811-25.558816-44.7559-38.330232-63.937l19.157124-6.3937c12.779408 19.1811 31.944524 44.7559 44.715939 70.3307h159.682658v31.9685h-63.873063c-19.157124 63.937-51.093655 121.4803-89.423887 159.8425 44.715939 38.3622 95.809594 70.3307 166.076358 89.5118l-25.550824 31.9685z" />
								</svg>
							)}
						</button>
					)}
					{/* 谷歌限流时显示人工验证提示 */}
					{needsVerify && (
						<div className="trailer-preview__verify">
							<span>{t.googleVerifyHint}</span>
							<button
								type="button"
								className="trailer-preview__verify-btn"
								onClick={() => openVerifyWindow(displayLongTitle || displayShortTitle || "")}
							>
								{t.openVerifyPage}
							</button>
						</div>
					)}
						</div>
					{/* 翻译错误信息区（每行一条：Worker 失败原因 + 备用服务失败原因），右上角单个关闭按钮 */}
					{translateErrors && translateErrors.length > 0 && (
						<div className="trailer-preview__translate-error" role="alert">
							<div className="trailer-preview__translate-error-list">
								{translateErrors.map((message, index) => (
									<span
										key={`${index}-${message}`}
										className="trailer-preview__translate-error-text"
									>
										{message}
									</span>
								))}
							</div>
							<button
								type="button"
								className="trailer-preview__translate-error-close"
								onClick={() => setTranslateErrors(null)}
								title={t.closeError}
								aria-label={t.closeError}
							>
								<svg
									viewBox="0 0 20 20"
									fill="currentColor"
									width="11"
									height="11"
									aria-hidden="true"
								>
									<path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
								</svg>
							</button>
						</div>
					)}
					<button
						type="button"
						className="trailer-preview__title-toggle"
						aria-expanded={titleExpanded}
						aria-label={titleExpanded ? t.collapseTitle : t.expandTitle}
						title={titleExpanded ? t.collapseTitle : t.expandTitle}
						onClick={() => setTitleExpanded((expanded) => !expanded)}
					>
						<svg
							viewBox="0 0 24 24"
							width="14"
							height="14"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							{/* 带长杆的箭头（不是单折角 chevron）：杆 + 两侧斜线组成箭头头部 */}
							<path
								d={
									titleExpanded
										? "M12 19V5M5.5 11.5L12 5l6.5 6.5"
										: "M12 5v14M5.5 12.5L12 19l6.5-6.5"
								}
							/>
						</svg>
					</button>
					</div>
				</div>
			)}

		</section>
	);
};
