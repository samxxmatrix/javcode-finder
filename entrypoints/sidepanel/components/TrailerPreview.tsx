import React, { useEffect, useRef, useState } from "react";
import type { DetailPageFallback } from "../../../src/lib/javtrailers";
import {
	buildGoogleVerifyUrl,
	buildMergedTranslateText,
	splitMergedTranslation,
} from "../../../src/lib/translate";
import type { LocaleMessages } from "../../../src/lib/locales";
import { getSettings } from "../../../src/lib/settings";
import type { SupportedLocale } from "../../../src/lib/types";
import { FavoriteIcon } from "./FavoriteIcon";

interface TrailerPreviewProps {
	code: string;
	locale: SupportedLocale;
	t: LocaleMessages;
	onClose: () => void;
	isFavorite: boolean;
	onToggleFavorite: () => void;
}

interface Resolution {
	// 数据来源：dmm（开关开启且查询命中）或 javtrailers（默认/兜底）
	source: "dmm" | "javtrailers" | null;
	contentId: string | null;
	// 短标题（商品名，加粗先行显示；javtrailers 源无此字段）
	shortTitle: string | null;
	// 长标题（dmm 长文描述或 javtrailers 卡片标题）
	title: string | null;
	// 封面/预告片 URL 由 background 按来源拼好返回
	coverUrl: string | null;
	previewUrl: string | null;
	previewType: "mp4" | "hls" | null;
	// 解析进行中：期间不加载封面、不判定失败，避免"先报错后显示封面"的闪烁
	resolving: boolean;
}

type PlayerStatus = "idle" | "loading" | "playing" | "not_found" | "failed";

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
			if (resolution.shortTitle) {
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
	const [resolution, setResolution] = useState<Resolution>({
		source: null,
		contentId: null,
		shortTitle: null,
		title: null,
		coverUrl: null,
		previewUrl: null,
		previewType: null,
		resolving: true,
	});
	// 重新加载计数：点击标题行番号时递增，触发重新解析
	const [reloadKey, setReloadKey] = useState(0);
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const hlsRef = useRef<{ destroy(): void } | null>(null);
	const rootRef = useRef<HTMLElement | null>(null);

	// 挂载时把预览卡片滚动到可视区域顶部（列表较长时点击番号可能看不见预览）
	useEffect(() => {
		rootRef.current?.scrollIntoView({ block: "start" });
	}, []);

	// 挂载时解析媒体信息：DMM 开关开启时 background 优先走 DMM API，未命中回退
	// javtrailers 搜索页解析；开关关闭时直接走 javtrailers（默认链路）。
	useEffect(() => {
		let disposed = false;
		void (async () => {
			try {
				const s = getSettings();
				const res = (await browser.runtime.sendMessage({
					type: "jt:resolve-detail",
					code,
					dmmEnabled: s.dmmEnabled,
					dmmApiUrl: s.dmmApiUrl,
					dmmApiKey: s.dmmApiKey,
				})) as
					| {
							source?: "dmm" | "javtrailers" | null;
							contentId?: string | null;
							title?: string | null;
							shortTitle?: string | null;
							coverUrl?: string | null;
							previewUrl?: string | null;
							previewType?: "mp4" | "hls" | null;
					  }
					| undefined;
				if (!disposed) {
					setResolution({
						source: res?.source || null,
						contentId: res?.contentId || null,
						shortTitle: res?.shortTitle || null,
						title: res?.title || null,
						coverUrl: res?.coverUrl || null,
						previewUrl: res?.previewUrl || null,
						previewType: res?.previewType || null,
						resolving: false,
					});
				}
			} catch {
				// background 无响应：结束解析状态，媒体不可用
				if (!disposed) {
					setResolution((prev) => ({ ...prev, resolving: false }));
				}
			}
		})();
		return () => {
			disposed = true;
		};
	}, [code, reloadKey]);

	// 封面/预告片 URL 由 background 按来源拼好（dmm 直链或 javtrailers HLS）
	const coverUrl = resolution.coverUrl || "";
	const trailerUrl = resolution.previewUrl || "";

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
		const title = resolution.title;
		if (!title) return;
		const shortTitle = resolution.shortTitle;
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
	}, [resolution.title, resolution.shortTitle, locale]);

	// 翻译失败后手动重试（验证窗口关闭后也自动调用）
	const handleRetryTranslate = async () => {
		const title = resolution.title;
		if (!title || retrying) return;
		setRetrying(true);
		try {
			const translateInput = resolution.shortTitle
				? buildMergedTranslateText(resolution.shortTitle, title)
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

	// 卸载或切换番号时销毁 hls 实例，停止后台拉流
	useEffect(() => {
		return () => {
			hlsRef.current?.destroy();
			hlsRef.current = null;
		};
	}, []);

	// 拉取详情页备用媒体；每个番号只拉一次（结果含 null 也缓存，不重复请求）
	const requestFallback = async (): Promise<DetailPageFallback> => {
		if (fallbackMedia) return fallbackMedia;
		let result: DetailPageFallback = { coverUrl: null, trailerUrl: null };
		try {
			const res = (await browser.runtime.sendMessage({
				type: "jt:resolve-fallback",
				contentId: resolution.contentId,
			})) as DetailPageFallback | undefined;
			if (res) result = res;
		} catch {
			// 拉取失败保持空兜底
		}
		setFallbackMedia(result);
		return result;
	};

	// 封面加载失败：dmm 源无备用封面直接判定失败；javtrailers 源尝试详情页备用封面
	const handleCoverError = () => {
		if (resolution.source !== "javtrailers" || coverSrc) {
			// 备用封面也失败，或 dmm 源无兜底
			setCoverLoading(false);
			setCoverError(true);
			return;
		}
		setCoverLoading(true);
		void (async () => {
			const fb = await requestFallback();
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
	const playFallbackTrailer = async () => {
		const fb = await requestFallback();
		const video = videoRef.current;
		if (!fb.trailerUrl || !video) {
			setStatus("not_found");
			return;
		}
		hlsRef.current?.destroy();
		hlsRef.current = null;
		video.src = fb.trailerUrl;
		setStatus("playing");
		void video.play().catch(() => setStatus("failed"));
	};

	const handlePlay = async () => {
		const video = videoRef.current;
		if (!video || status === "loading" || status === "playing") return;

		// 播放开始时应用设置中的预览音量（0-100 → 0-1）
		video.volume = getSettings().previewVolume / 100;

		setStatus("loading");
		// dmm 源：mp4 直链直接播放，无需 hls.js 与 CORS 处理
		if (resolution.source === "dmm" && trailerUrl) {
			video.src = trailerUrl;
			setStatus("playing");
			void video.play().catch(() => setStatus("failed"));
			return;
		}
		try {
			// 懒加载 hls.js（~200KB），仅首次点播放时拉取，不拖慢面板首开
			const { default: Hls } = await import("hls.js");
			if (Hls.isSupported()) {
				const hls = new Hls();
				hlsRef.current = hls;
				hls.loadSource(trailerUrl);
				hls.attachMedia(video);
				hls.on(Hls.Events.MANIFEST_PARSED, () => {
					setStatus("playing");
					// 处于用户点击手势内，不会被自动播放策略拦截
					void video.play().catch(() => {});
				});
				hls.on(Hls.Events.ERROR, (_event, data) => {
					if (!data.fatal) return;
					// 404 说明该番号无 HLS 预告片；尝试详情页备用 MP4 兜底
					if (data.response?.code === 404) {
						void playFallbackTrailer();
						return;
					}
					// 其余（含 Firefox 上无 DNR 规则导致的 CORS 失败）按加载失败处理
					setStatus("failed");
					hlsRef.current?.destroy();
					hlsRef.current = null;
				});
			} else if (video.canPlayType("application/vnd.apple.mpegurl")) {
				// Safari 原生支持 HLS，无需 hls.js
				video.src = trailerUrl;
				setStatus("playing");
				void video.play().catch(() => {});
			} else {
				setStatus("failed");
			}
		} catch {
			setStatus("failed");
		}
	};

	// 点击标题行番号：重置全部加载状态后重新解析预览
	const handleReload = () => {
		hlsRef.current?.destroy();
		hlsRef.current = null;
		setStatus("idle");
		setCoverError(false);
		setTranslatedShort(null);
		setTranslatedLong(null);
		setTitleReady(false);
		setTranslateErrors(null);
		setResolution({
			source: null,
			contentId: null,
			shortTitle: null,
			title: null,
			coverUrl: null,
			previewUrl: null,
			previewType: null,
			resolving: true,
		});
		setReloadKey((k) => k + 1);
	};

	const handleClose = () => {
		hlsRef.current?.destroy();
		hlsRef.current = null;
		onClose();
	};

	// 短标题行内容：dmm 商品名或 javtrailers 卡片标题；长标题行内容：仅 dmm 长文
	const displayShortTitle =
		resolution.shortTitle ||
		(resolution.source === "javtrailers" ? resolution.title : null);
	const displayLongTitle = resolution.shortTitle ? resolution.title : null;

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
					style={{ display: status === "playing" ? "block" : "none" }}
				/>
				{status !== "playing" &&
					(resolution.resolving ? (
						<div className="trailer-preview__media-message">
							<span className="spinner" aria-hidden="true" />
						</div>
					) : !resolution.contentId ||
					  coverError ||
					  status === "not_found" ||
					  status === "failed" ? (
						<div className="trailer-preview__media-message">
							<span>{t.previewUnavailable}</span>
						</div>
					) : (
						<div className="trailer-preview__cover-layer">
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
								// 不用 loading="lazy"：隐藏（display:none）期间懒加载不触发下载，onLoad 永不回调会死锁
								style={coverLoading ? { display: "none" } : undefined}
							/>
							{status === "loading" ? (
								// 点击播放后隐藏按钮，仅显示加载中的 spinner
								<span className="trailer-preview__loading" aria-hidden="true">
									<span className="spinner" />
								</span>
							) : trailerUrl ? (
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
					))}
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
