import React, { useEffect, useRef, useState } from "react";
import {
	buildCoverUrlFromContentId,
	buildTrailerUrlFromContentId,
} from "../../../src/lib/javtrailers";
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
	contentId: string | null;
	// 影片完整标题（来自 javtrailers 卡片）
	title: string | null;
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
	const [status, setStatus] = useState<PlayerStatus>("idle");
	// 标题译文（中文/繁中界面下通过谷歌翻译获取；失败或英文界面保持 null）
	const [translatedTitle, setTranslatedTitle] = useState<string | null>(null);
	// 标题显示就绪：翻译流程结束（成功/失败）或英文界面直接跳过。期间不渲染标题区，避免原文→译文的闪烁
	const [titleReady, setTitleReady] = useState(false);
	// 手动重试翻译进行中
	const [retrying, setRetrying] = useState(false);

	// 请求翻译并返回译文（空字符串 = 失败）；DeepL key 从设置读取随消息携带
	const requestTranslate = async (title: string): Promise<string> => {
		const res = (await browser.runtime.sendMessage({
			type: "jt:translate",
			text: title,
			target: locale === "zh-hant" ? "zh-TW" : "zh-CN",
			deeplKey: getSettings().deeplApiKey,
		})) as { translated?: string; error?: string } | undefined;
		if (!res?.translated) {
			console.warn("[JavCode Finder] 翻译失败:", res?.error || "empty");
		}
		return res?.translated || "";
	};
	// 通过 background 解析到的 Content ID（javtrailers 完整格式，含前缀与补零）
	const [resolution, setResolution] = useState<Resolution>({
		contentId: null,
		title: null,
		resolving: true,
	});
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const hlsRef = useRef<{ destroy(): void } | null>(null);
	const rootRef = useRef<HTMLElement | null>(null);

	// 挂载时把预览卡片滚动到可视区域顶部（列表较长时点击番号可能看不见预览）
	useEffect(() => {
		rootRef.current?.scrollIntoView({ block: "start" });
	}, []);

	// 挂载时解析 Content ID：番号→Content ID 不可靠推导（如 DLDSS-547 → 1dldss00547），
	// 必须走搜索页解析；失败时用补零规则兜底（对无前缀番号仍有效）
	useEffect(() => {
		let disposed = false;
		void (async () => {
			try {
				const res = (await browser.runtime.sendMessage({
					type: "jt:resolve-detail",
					code,
				})) as
					| {
							contentId?: string | null;
							title?: string | null;
					  }
					| undefined;
				if (!disposed) {
					setResolution({
						contentId: res?.contentId || null,
						title: res?.title || null,
						resolving: false,
					});
				}
			} catch {
				// background 无响应：结束解析状态，走补零兜底
				if (!disposed) {
					setResolution((prev) => ({ ...prev, resolving: false }));
				}
			}
		})();
		return () => {
			disposed = true;
		};
	}, [code]);

	// 封面/预告片/详情页 URL 一律以解析出的 Content ID 为准（无兜底猜测）
	const coverUrl = resolution.contentId
		? buildCoverUrlFromContentId(resolution.contentId)
		: "";
	const trailerUrl = resolution.contentId
		? buildTrailerUrlFromContentId(resolution.contentId)
		: "";

	// 解析到 Content ID 后封面 URL 变化，重置加载失败状态以重新尝试
	useEffect(() => {
		setCoverError(false);
	}, [coverUrl]);

	// 中文/繁中界面下翻译标题；英文界面不翻译。失败保持 null（回退原文）
	useEffect(() => {
		if (!resolution.title) return;
		if (locale === "en") {
			setTitleReady(true);
			return;
		}
		setTitleReady(false);
		let disposed = false;
		void (async () => {
			try {
				const translated = await requestTranslate(resolution.title!);
				if (!disposed) {
					if (translated) {
						setTranslatedTitle(translated);
					}
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
	}, [resolution.title, locale]);

	// 翻译失败后手动重试
	const handleRetryTranslate = async () => {
		if (!resolution.title || retrying) return;
		setRetrying(true);
		try {
			const translated = await requestTranslate(resolution.title);
			if (translated) {
				setTranslatedTitle(translated);
			}
		} catch {
			// 保持失败状态，图标仍在可再次点击
		} finally {
			setRetrying(false);
		}
	};

	// 卸载或切换番号时销毁 hls 实例，停止后台拉流
	useEffect(() => {
		return () => {
			hlsRef.current?.destroy();
			hlsRef.current = null;
		};
	}, []);

	const handlePlay = async () => {
		const video = videoRef.current;
		if (!video || status === "loading" || status === "playing") return;

		// 播放开始时应用设置中的预览音量（0-100 → 0-1）
		video.volume = getSettings().previewVolume / 100;

		setStatus("loading");
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
					// 404 说明该番号无预告片；其余（含 Firefox 上无 DNR 规则导致的 CORS 失败）按加载失败处理
					setStatus(data.response?.code === 404 ? "not_found" : "failed");
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

	const handleClose = () => {
		hlsRef.current?.destroy();
		hlsRef.current = null;
		onClose();
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
					<span className="trailer-preview__code">{code}</span>
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
							<img
								src={coverUrl}
								alt={`${code} cover`}
								className="trailer-preview__cover"
								loading="lazy"
								referrerPolicy="no-referrer"
								onError={() => setCoverError(true)}
							/>
							{status === "loading" ? (
								// 点击播放后隐藏按钮，仅显示加载中的 spinner
								<span className="trailer-preview__loading" aria-hidden="true">
									<span className="spinner" />
								</span>
							) : (
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
							)}
						</div>
					))}
			</div>

			{resolution.title && titleReady && (
				<div className="trailer-preview__title-area">
					<p className="trailer-preview__title-text">
						{translatedTitle || resolution.title}
						{/* 中文/繁中界面翻译失败时显示重试图标 */}
						{locale !== "en" && !translatedTitle && (
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
					</p>
				</div>
			)}

		</section>
	);
};
