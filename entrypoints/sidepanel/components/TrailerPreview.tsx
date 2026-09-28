import React, { useCallback, useEffect, useRef, useState } from "react";
import type { DetailPageFallback } from "../../../src/lib/javtrailers";
import {
	destroyHlsBefore,
	destroyHlsInstance,
} from "../../../src/lib/hls-instance";
import {
	getPreviewPresentation,
	transitionPreviewNotice,
} from "../../../src/lib/preview-state";
import {
	buildGoogleVerifyUrl,
	buildMergedTranslateText,
	splitMergedTranslation,
} from "../../../src/lib/translate";
import type { LocaleMessages } from "../../../src/lib/locales";
import { getSettings } from "../../../src/lib/settings";
import type {
	PreviewLookupError,
	PreviewMedia,
	PreviewResolution,
	SupportedLocale,
} from "../../../src/lib/types";
import { FavoriteIcon } from "./FavoriteIcon";

interface TrailerPreviewProps {
	code: string;
	locale: SupportedLocale;
	t: LocaleMessages;
	onClose: () => void;
	isFavorite: boolean;
	onToggleFavorite: () => void;
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
	// 标题译文（拼装翻译后拆分还原：短标题译文 + 长标题译文；失败或英文界面保持 null）
	const [translatedShort, setTranslatedShort] = useState<string | null>(null);
	const [translatedLong, setTranslatedLong] = useState<string | null>(null);
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

	// 翻译结果应用到状态：拼装翻译时按 <code> 保护标记（翻译后还原为花括号）拆分短/长标题译文；
	// javtrailers 源无拼装（卡片标题即短标题），译文放短标题行
	const applyTranslation = (result: {
		translated: string;
		error?: string;
		workerError?: string;
	}) => {
		setNeedsVerify(false);
		if (result.translated) {
			if (media?.shortTitle) {
				// dmm 源：拼装翻译，拆不出时整体作为长标题译文
				const split = splitMergedTranslation(result.translated);
				setTranslatedShort(split.short);
				setTranslatedLong(split.long);
			} else {
				// javtrailers 源：译文即短标题译文
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

	// 挂载时把预览卡片滚动到可视区域顶部（列表较长时点击番号可能看不见预览）
	useEffect(() => {
		rootRef.current?.scrollIntoView({ block: "start" });
	}, []);

	const media: PreviewMedia | null =
		resolution.status === "resolved" ? resolution.media : null;
	const coverUrl = media?.coverUrl || "";
	const trailerUrl = media?.previewUrl || "";

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
		setNoticeDismissed((dismissed) =>
			transitionPreviewNotice(dismissed, "lookup_retry"),
		);
		setTranslatedShort(null);
		setTranslatedLong(null);
		setTitleReady(false);
		setNeedsVerify(false);
		setRetrying(false);
		setTranslateErrors(null);

		try {
			const settings = getSettings();
			const response = (await browser.runtime.sendMessage({
				type: "jt:resolve-detail",
				code,
				dmmEnabled: settings.dmmEnabled,
				dmmApiUrl: settings.dmmApiUrl,
				dmmApiKey: settings.dmmApiKey,
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
	}, [coverUrl]);

	// 中文/繁中界面下翻译标题；英文界面不翻译。失败保持 null（回退原文）
	// 短标题与长标题拼装一次发送（短标题 <code> 标签保护标记），返回后还原拆分
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

	// 封面加载失败：dmm 源无备用封面直接判定失败；javtrailers 源尝试详情页备用封面
	const handleCoverError = () => {
		if (media?.source !== "javtrailers" || coverSrc) {
			// 备用封面也失败，或 dmm 源无兜底
			setCoverLoading(false);
			setCoverError(true);
			return;
		}
		setCoverLoading(true);
		const requestId = resolutionRequestRef.current;
		void (async () => {
			const fb = await requestFallback(media?.contentId ?? null, requestId);
			if (requestId !== resolutionRequestRef.current) return;
			if (fb.coverUrl) {
				// 备用图加载完成后由 onLoad 恢复显示
				setCoverSrc(fb.coverUrl);
			} else {
				setCoverLoading(false);
				setCoverError(true);
			}
		})();
	};

	// HLS 404 后的兜底（仅 javtrailers 源）：用详情页的 sample MP4 直连播放
	const playFallbackTrailer = async (requestId: number) => {
		const fb = await destroyHlsBefore(hlsRef, () =>
			requestFallback(
				media?.contentId ?? null,
				resolutionRequestRef.current,
			),
		);
		if (requestId !== playbackRequestRef.current) return;
		const video = videoRef.current;
		if (!fb.trailerUrl || !video) {
			setStatus("failed");
			return;
		}
		video.src = fb.trailerUrl;
		setStatus("loading");
		void video.play().then(
			() => {
				if (requestId === playbackRequestRef.current) setStatus("playing");
			},
			() => {
				if (requestId === playbackRequestRef.current) setStatus("failed");
			},
		);
	};

	const handlePlay = async () => {
		const video = videoRef.current;
		if (!video || status === "loading" || status === "playing") return;
		setNoticeDismissed((dismissed) =>
			transitionPreviewNotice(dismissed, "playback_retry"),
		);
		const requestId = ++playbackRequestRef.current;
		videoPlaybackRequestRef.current = requestId;
		destroyHlsInstance(hlsRef);

		// 播放开始时应用设置中的预览音量（0-100 → 0-1）
		video.volume = getSettings().previewVolume / 100;

		setStatus("loading");
		// dmm 源：mp4 直链直接播放，无需 hls.js 与 CORS 处理
		if (media?.source === "dmm" && trailerUrl) {
			video.src = trailerUrl;
			void video.play().then(
				() => {
					if (requestId === playbackRequestRef.current) setStatus("playing");
				},
				() => {
					if (requestId === playbackRequestRef.current) setStatus("failed");
				},
			);
			return;
		}
		try {
			// 懒加载 hls.js light 构建，仅首次点播放时加载，不拖慢面板首开
			const { default: Hls } = await import("hls.js/light");
			if (requestId !== playbackRequestRef.current) return;
			if (Hls.isSupported()) {
				const hls = new Hls();
				hlsRef.current = hls;
				hls.loadSource(trailerUrl);
				hls.attachMedia(video);
				hls.on(Hls.Events.MANIFEST_PARSED, () => {
					if (requestId !== playbackRequestRef.current) return;
					setStatus("playing");
					// 处于用户点击手势内，不会被自动播放策略拦截
					void video.play().catch(() => {
						if (requestId !== playbackRequestRef.current) return;
						setStatus("failed");
						destroyHlsInstance(hlsRef);
					});
				});
				hls.on(Hls.Events.ERROR, (_event, data) => {
					if (requestId !== playbackRequestRef.current) return;
					if (!data.fatal) return;
					// 404 说明该番号无 HLS 预告片；尝试详情页备用 MP4 兜底
					if (data.response?.code === 404) {
						void playFallbackTrailer(requestId);
						return;
					}
					// 其余（含 Firefox 上无 DNR 规则导致的 CORS 失败）按加载失败处理
					setStatus("failed");
					destroyHlsInstance(hlsRef);
				});
			} else if (video.canPlayType("application/vnd.apple.mpegurl")) {
				// Safari 原生支持 HLS，无需 hls.js
				video.src = trailerUrl;
				void video.play().then(
					() => {
						if (requestId === playbackRequestRef.current) setStatus("playing");
					},
					() => {
						if (requestId === playbackRequestRef.current) setStatus("failed");
					},
				);
			} else {
				setStatus("failed");
			}
		} catch {
			if (requestId === playbackRequestRef.current) setStatus("failed");
		}
	};

	const handleReload = () => void resolveCurrentCode();

	const handleClose = () => {
		destroyHlsInstance(hlsRef);
		onClose();
	};

	// 短标题行内容：dmm 商品名或 javtrailers 卡片标题；长标题行内容：仅 dmm 长文
	const displayShortTitle =
		media?.shortTitle || (media?.source === "javtrailers" ? media.title : null);
	const displayLongTitle = media?.shortTitle ? media.title : null;
	const presentation = getPreviewPresentation({
		resolution,
		playbackStatus: status,
		hasCover: Boolean(media?.coverUrl) && !coverError,
		hasTrailer: Boolean(media?.previewUrl),
		noticeDismissed,
	});
	const formatLookupError = (error: PreviewLookupError) => {
		const sourceLabel =
			error.source === "dmm" ? t.dmmSourceLabel : t.javtrailersSourceLabel;
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
					return t.playbackFailed;
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
	// （DMM 长文与翻译结果都可能含 <br> 或连续 \n）
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
					<button
						type="button"
						className="trailer-preview__fav"
						onClick={onToggleFavorite}
						title={isFavorite ? t.removeFavorite : t.addFavorite}
						aria-label={isFavorite ? t.removeFavorite : t.addFavorite}
					>
						<FavoriteIcon active={isFavorite} />
					</button>
				</h3>
				<button
					type="button"
					className="trailer-preview__close"
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
						display: status === "playing" ? "block" : "none",
						height: status === "playing" && noticeText ? "calc(100% - 32px)" : undefined,
					}}
					onError={() => {
						if (
							videoPlaybackRequestRef.current === playbackRequestRef.current &&
							(status === "playing" || status === "loading")
						) {
							setStatus("failed");
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
					(presentation.mediaMessage || coverError ? (
						<div className="trailer-preview__media-message" role="status">
							<span>
								{presentation.mediaMessage === "no_number_information"
									? t.noNumberInformation
									: presentation.mediaMessage === "playback_failed"
										? t.playbackFailed
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
								<span className="trailer-preview__loading" aria-hidden="true">
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
			</div>

			{(displayShortTitle || displayLongTitle) && (
				<div className="trailer-preview__title-area">
					{/* 短标题行：金色（dmm 商品名 / javtrailers 卡片标题），解析到即显示；翻译完成后替换为译文 */}
					{displayShortTitle && (
						<p className="trailer-preview__title-short">
							{renderTitleText(translatedShort || displayShortTitle)}
						</p>
					)}
					{/* 长标题行：仅 dmm 源的长文，翻译流程结束后显示，避免原文→译文的闪烁 */}
					{displayLongTitle && titleReady && (
						<p className="trailer-preview__title-text">
							{renderTitleText(translatedLong || displayLongTitle || "")}
						</p>
					)}
					{/* 中文/繁中界面翻译失败时显示重试图标（短/长标题行共用） */}
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
				</div>
			)}

		</section>
	);
};
