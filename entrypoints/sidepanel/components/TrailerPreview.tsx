import React, { useEffect, useRef, useState } from "react";
import {
	buildCoverUrlFromContentId,
	buildTrailerUrlFromContentId,
} from "../../../src/lib/javtrailers";
import type { LocaleMessages } from "../../../src/lib/locales";
import { getSettings } from "../../../src/lib/settings";

interface TrailerPreviewProps {
	code: string;
	t: LocaleMessages;
	onClose: () => void;
}

interface Resolution {
	contentId: string | null;
	detailUrl: string | null;
	// 解析进行中：期间不加载封面、不判定失败，避免"先报错后显示封面"的闪烁
	resolving: boolean;
}

type PlayerStatus = "idle" | "loading" | "playing" | "not_found" | "failed";

export const TrailerPreview: React.FC<TrailerPreviewProps> = ({
	code,
	t,
	onClose,
}) => {
	const [coverError, setCoverError] = useState(false);
	const [status, setStatus] = useState<PlayerStatus>("idle");
	// 通过 background 解析到的 Content ID（javtrailers 完整格式，含前缀与补零）
	const [resolution, setResolution] = useState<Resolution>({
		contentId: null,
		detailUrl: null,
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
				})) as { detailUrl?: string | null; contentId?: string | null } | undefined;
				if (!disposed) {
					setResolution({
						contentId: res?.contentId || null,
						detailUrl: res?.detailUrl || null,
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
	const detailUrl = resolution.detailUrl || "";

	// 解析到 Content ID 后封面 URL 变化，重置加载失败状态以重新尝试
	useEffect(() => {
		setCoverError(false);
	}, [coverUrl]);

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

			{(status === "not_found" || status === "failed") && (
				<div className="trailer-preview__error" role="status">
					<span>
						{status === "not_found"
							? t.trailerUnavailable
							: t.trailerLoadFailed}
					</span>
					{detailUrl && (
						<a
							href={detailUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="trailer-preview__external-link"
						>
							{t.openOnJavtrailers} &rarr;
						</a>
					)}
				</div>
			)}
		</section>
	);
};
