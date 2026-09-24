import React, { useEffect, useRef, useState } from "react";
import { extractCandidatesInTab } from "../../src/lib/extract-codes";
import {
	FAVORITES_STORAGE_KEY,
	loadFavorites,
	parseFavorites,
	parseStoredFavorites,
	saveFavorites,
	serializeFavorites,
	toggleFavorite,
} from "../../src/lib/favorites";
import { messages } from "../../src/lib/locales";
import {
	DEFAULT_CODE_REGEX,
	getEffectiveLocale,
	getSettings,
	getStorage,
	isHostExcluded,
} from "../../src/lib/settings";
import type {
	ExtractionResult,
	PopupStatus,
	SupportedLocale,
} from "../../src/lib/types";
import { CodeList } from "./components/CodeList";
import { SettingsView, type SettingsViewHandle } from "./components/SettingsView";
import { TrailerPreview } from "./components/TrailerPreview";

export const App: React.FC = () => {
	const [locale, setLocale] = useState<SupportedLocale>(() =>
		getEffectiveLocale(),
	);
	const t = messages[locale];

	const boundTabId = React.useMemo(() => {
		if (typeof window === "undefined" || !window.location) return null;
		const val = new URLSearchParams(window.location.search).get("tabId");
		return val ? parseInt(val, 10) : null;
	}, []);

	const [status, setStatus] = useState<PopupStatus>("loading");
	const [showSettings, setShowSettings] = useState(false);
	const [candidates, setCandidates] = useState<string[]>([]);
	const [truncated, setTruncated] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	// 点击番号后在列表上方展开的预告片预览
	const [previewCode, setPreviewCode] = useState<string | null>(null);
	// 顶部图标按钮调用设置页的保存/重置
	const settingsRef = useRef<SettingsViewHandle>(null);
	// 收藏的番号列表（本地 storage 为准，云端为镜像）
	const [favorites, setFavorites] = useState<string[]>([]);
	// 云端推送防抖计时器（合并连续收藏操作，降低请求频率）
	const cloudPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// 提取当前绑定/激活标签页的番号候选
	const extractFromActiveTab = async (
		settings: ReturnType<typeof getSettings>,
	): Promise<ExtractionResult & { excluded?: boolean }> => {
		let activeTab: { id?: number; url?: string } | undefined;
		if (boundTabId) {
			try {
				activeTab = await browser.tabs.get(boundTabId);
			} catch {
				// Bound tab might have closed or cannot be retrieved
			}
		}
		if (!activeTab) {
			// Query active tab in the browser window
			let tabs = await browser.tabs.query({
				active: true,
				lastFocusedWindow: true,
			});
			if (!tabs || tabs.length === 0) {
				tabs = await browser.tabs.query({
					active: true,
					currentWindow: true,
				});
			}
			activeTab = tabs && tabs.length > 0 ? tabs[0] : undefined;
		}
		if (!activeTab || !activeTab.id) {
			return { candidates: [], truncated: false, unsupported: true };
		}

		const url = activeTab.url || "";
		if (isHostExcluded(url, settings.excludedHosts)) {
			return { candidates: [], truncated: false, excluded: true };
		}

		// Check for restricted URLs if available
		const lowerUrl = url.toLowerCase();
		if (
			lowerUrl.startsWith("chrome://") ||
			lowerUrl.startsWith("chrome-extension://") ||
			lowerUrl.startsWith("edge://") ||
			lowerUrl.startsWith("about:") ||
			lowerUrl.startsWith("chrome.google.com/webstore") ||
			lowerUrl.startsWith("chromewebstore.google.com") ||
			lowerUrl.startsWith("addons.mozilla.org")
		) {
			return { candidates: [], truncated: false, unsupported: true };
		}

		try {
			const results = await browser.scripting.executeScript({
				target: { tabId: activeTab.id },
				func: extractCandidatesInTab,
				args: [settings.customRegex || DEFAULT_CODE_REGEX],
			});

			const firstResult =
				results && results.length > 0 ? results[0]?.result : undefined;
			if (!firstResult) {
				return { candidates: [], truncated: false };
			}

			return firstResult as ExtractionResult;
		} catch (err) {
			console.warn("ExecuteScript failed on tab:", activeTab.id, err);
			return { candidates: [], truncated: false, unsupported: true };
		}
	};

	const runScan = async () => {
		setStatus("loading");
		setErrorMessage(null);
		setCandidates([]);
		setTruncated(false);
		setPreviewCode(null);

		const settings = getSettings();

		try {
			const extraction = await extractFromActiveTab(settings);

			if (extraction.excluded) {
				setStatus("excluded_site");
				return;
			}

			if (extraction.unsupported) {
				setStatus("unsupported_page");
				return;
			}

			setTruncated(extraction.truncated);
			setCandidates(extraction.candidates);

			setStatus(
				extraction.candidates.length === 0 ? "no_candidates" : "results",
			);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			setErrorMessage(msg);
			setStatus("error");
		}
	};

	const handleRefresh = async () => {
		await runScan();
	};

	// 从云端拉取收藏并覆盖本地（仅本地为空时调用，避免覆盖较新的本地数据）
	const pullFromCloud = async (): Promise<void> => {
		const s = getSettings();
		if (!s.webdavUrl.trim() || !s.webdavUser.trim()) return;
		try {
			const res = (await browser.runtime.sendMessage({
				type: "jt:webdav-get",
				webdavUrl: s.webdavUrl,
				webdavUser: s.webdavUser,
				webdavPass: s.webdavPass,
			})) as { found?: boolean; data?: unknown } | undefined;
			if (!res?.found) return;
			const codes = parseFavorites(res.data);
			if (codes.length === 0) return;
			setFavorites(codes);
			saveFavorites(getStorage(), codes);
		} catch (err) {
			console.warn("[JavCode Finder] 云端拉取失败:", err);
		}
	};

	// 推送收藏到云端（整体覆盖；失败静默，下一次成功推送自动补偿）
	const pushToCloud = async (codes: string[]): Promise<void> => {
		const s = getSettings();
		if (!s.webdavUrl.trim() || !s.webdavUser.trim()) return;
		try {
			await browser.runtime.sendMessage({
				type: "jt:webdav-put",
				webdavUrl: s.webdavUrl,
				webdavUser: s.webdavUser,
				webdavPass: s.webdavPass,
				body: serializeFavorites(codes),
			});
		} catch (err) {
			console.warn("[JavCode Finder] 云端推送失败:", err);
		}
	};

	// 切换收藏：更新本地并防抖 2s 推送云端。
	// 云端 PUT 只由用户操作发起的这个面板执行，其他面板仅通过 onChanged 同步 UI。
	const handleToggleFavorite = (code: string) => {
		const next = toggleFavorite(favorites, code);
		setFavorites(next);
		// 本地写入失败仅保留内存状态；云端推送照常执行
		saveFavorites(getStorage(), next);
		if (cloudPushTimerRef.current) clearTimeout(cloudPushTimerRef.current);
		cloudPushTimerRef.current = setTimeout(() => {
			void pushToCloud(next);
		}, 2000);
	};

	// 加载本地收藏；本地为空且已配置云端时尝试拉取（换设备/换浏览器场景）
	useEffect(() => {
		const codes = loadFavorites(getStorage());
		setFavorites(codes);
		if (codes.length === 0) {
			void pullFromCloud();
		}

		// 其他面板写入收藏时同步 UI（storage 事件只在其他页面触发，天然不会重复推送云端）
		const handleStorageEvent = (e: StorageEvent) => {
			if (e.key !== FAVORITES_STORAGE_KEY) return;
			setFavorites(parseStoredFavorites(e.newValue));
		};
		window.addEventListener("storage", handleStorageEvent);
		return () => {
			window.removeEventListener("storage", handleStorageEvent);
		};
	}, []);

	useEffect(() => {
		// Keep port open to notify background of sidepanel lifecycle for this tab
		let port: ReturnType<typeof browser.runtime.connect> | undefined;
		if (
			boundTabId &&
			typeof browser !== "undefined" &&
			browser.runtime?.connect
		) {
			try {
				port = browser.runtime.connect({ name: `sidepanel:${boundTabId}` });
			} catch {
				// Ignore port connection errors
			}
		}

		runScan();

		const handleTabActivated = () => {
			// If bound to a specific tab, do not re-scan when switching to other tabs
			if (!boundTabId) {
				runScan();
			}
		};

		const handleTabUpdated = (
			tabId: number,
			changeInfo: { status?: string },
		) => {
			if (
				(!boundTabId || tabId === boundTabId) &&
				changeInfo.status === "complete"
			) {
				runScan();
			}
		};

		if (typeof browser !== "undefined" && browser.tabs) {
			browser.tabs.onActivated?.addListener(handleTabActivated);
			browser.tabs.onUpdated?.addListener(handleTabUpdated);
		}

		return () => {
			if (port) {
				try {
					port.disconnect();
				} catch {
					// Ignore
				}
			}
			if (typeof browser !== "undefined" && browser.tabs) {
				browser.tabs.onActivated?.removeListener(handleTabActivated);
				browser.tabs.onUpdated?.removeListener(handleTabUpdated);
			}
		};
	}, [locale, boundTabId]);

	return (
		<div className="popup-container">
			<header className="popup-header">
				<div className="popup-header__brand">
					<h1 className="popup-header__title popup-header__title--text">
						{t.title}
					</h1>
				</div>
				<div className="popup-header__actions">
					{showSettings ? (
						<>
							{/* 设置页：保存与恢复默认以图标方式置于顶部，替代原底部按钮 */}
							<button
								type="button"
								className="popup-header__icon-btn"
								onClick={() => {
									// 保存成功（正则校验通过、云端验证通过）后自动回到识别页面
									if (settingsRef.current) {
										void settingsRef.current.save().then((ok) => {
											if (ok) {
												setShowSettings(false);
												runScan();
											}
										});
									}
								}}
								title={t.saveSettings}
								aria-label={t.saveSettings}
							>
								<svg
									viewBox="0 0 1024 1024"
									fill="currentColor"
									width="15"
									height="15"
									aria-hidden="true"
								>
									<path d="M838.29394531 149.45142937H742.71314812v286.74316406c0 28.01462173-26.36770249 41.19847298-52.73463249 41.19847298H327.42994499c-28.01539421 0-46.14309311-14.83154297-46.14309311-41.19847298v-286.74316406H179.11451531c-28.01539421 0-46.14309311 29.66308594-46.14309312 57.67770767V833.35009766c0 26.36693001 18.1276989 41.19847298 46.14309312 41.19847297H838.29394531c28.01539421 0 52.73463249-14.83154297 52.7346325-41.19847297V207.12913704c0-28.01462173-26.36770249-57.67770767-52.7346325-57.67770767z"></path><path d="M327.42994499 446.08228874H689.97851563c9.88769531 0 19.77539063 0 19.77539062-8.24000358V149.45142937H314.24609375V437.84228516c0 8.24000359 3.29615593 8.24000359 13.18385124 8.24000358z m283.44700814-173.03466796c0-9.88769531 6.59153938-16.48000718 16.47923469-16.48000718s16.48000718 6.59231186 16.48000717 16.48000718V338.96533203c0 9.88769531-6.59231186 16.47923469-16.48000717 16.47923469S610.87695313 348.85302734 610.87695313 338.96533203v-65.91771126z" />
								</svg>
							</button>
							<button
								type="button"
								className="popup-header__icon-btn"
								onClick={() => settingsRef.current?.reset()}
								title={t.resetDefaults}
								aria-label={t.resetDefaults}
							>
								<svg
									viewBox="0 0 1024 1024"
									fill="currentColor"
									width="16"
									height="16"
									aria-hidden="true"
								>
									<path d="M512 124.540541C297.513514 124.540541 124.540541 297.513514 124.540541 512s172.972973 387.459459 387.459459 387.459459 387.459459-172.972973 387.459459-387.459459S726.486486 124.540541 512 124.540541zM257.383784 361.167568l40.12973-11.070271 9.686486 35.978379c9.686486-16.605405 22.140541-31.827027 35.978378-45.664865 48.432432-47.048649 106.551351-70.572973 174.356757-70.572973 67.805405 0 125.924324 23.524324 174.356757 70.572973 23.524324 22.140541 41.513514 48.432432 53.967567 78.875675l-38.745945 16.605406c-9.686486-24.908108-24.908108-47.048649-44.281082-65.037838-40.12973-38.745946-88.562162-59.502703-145.297297-59.502703s-105.167568 19.372973-145.297297 59.502703c-12.454054 11.07027-22.140541 24.908108-31.827027 38.745946l40.12973-11.07027 11.07027 40.129729-106.551352 27.675676-27.675675-105.167567z m484.324324 307.2l-9.686486-35.978379c-11.07027 19.372973-24.908108 35.978378-40.12973 51.2-48.432432 47.048649-106.551351 70.572973-174.356757 70.572973-67.805405 0-125.924324-23.524324-174.356757-70.572973-23.524324-22.140541-41.513514-48.432432-53.967567-78.875675l38.745946-16.605406c9.686486 24.908108 24.908108 47.048649 44.281081 65.037838 40.12973 38.745946 88.562162 59.502703 145.297297 59.502703s105.167568-19.372973 145.297297-59.502703c13.837838-12.454054 24.908108-27.675676 34.594595-44.281081l-38.745946 11.07027-11.07027-40.12973 106.551351-27.675675 29.05946 105.167567-41.513514 11.070271z" />
								</svg>
							</button>
						</>
					) : (
						<button
							type="button"
							className="popup-header__icon-btn"
							onClick={handleRefresh}
							title={
								locale === "zh-hans"
									? "重新扫描页面"
									: locale === "zh-hant"
										? "重新掃描頁面"
										: "Rescan Page"
							}
							aria-label="Rescan"
						>
							<svg
								className={`icon-refresh ${status === "loading" ? "icon-refresh--spinning" : ""}`}

								viewBox="0 0 20 20"
								fill="currentColor"
								width="16"
								height="16"
								aria-hidden="true"
							>
								<path
									fillRule="evenodd"
									d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
									clipRule="evenodd"
								/>
							</svg>
						</button>
					)}
					<button
						type="button"
						className={`popup-header__icon-btn ${showSettings ? "popup-header__icon-btn--active" : ""}`}
						onClick={() => setShowSettings(!showSettings)}
						title={t.settingsTitle}
						aria-label={t.settingsTitle}
					>
						<svg
							className="icon-gear"
							viewBox="0 0 20 20"
							fill="currentColor"
							width="16"
							height="16"
							aria-hidden="true"
						>
							<path
								fillRule="evenodd"
								d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
								clipRule="evenodd"
							/>
						</svg>
					</button>
				</div>
			</header>

			{truncated && !showSettings && (
				<div className="popup-alert popup-alert--warning" role="alert">
					<svg
						className="icon-warning"
						viewBox="0 0 20 20"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							fillRule="evenodd"
							d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
							clipRule="evenodd"
						/>
					</svg>
					<span>{t.truncatedWarning}</span>
				</div>
			)}

			<main className="popup-main">
				{previewCode && !showSettings && (
					// key 强制切换番号时重挂载：立即销毁旧 hls 实例停止播放，并重置加载状态
					<TrailerPreview
						key={previewCode}
						code={previewCode}
						locale={locale}
						t={t}
						onClose={() => setPreviewCode(null)}
						isFavorite={favorites.includes(previewCode)}
						onToggleFavorite={() => handleToggleFavorite(previewCode)}
					/>
				)}
				{showSettings ? (
					<SettingsView
						ref={settingsRef}
						locale={locale}
						t={t}
						onBack={() => {
							setShowSettings(false);
							runScan();
						}}
						onLocaleChange={(newLocale) => setLocale(newLocale)}
						onWebdavConnected={() => {
							// 云端开通：本地空 → 拉取云端；本地有 → 立即推送备份
							if (favorites.length === 0) {
								void pullFromCloud();
							} else {
								void pushToCloud(favorites);
							}
						}}
					/>

				) : (
					<>
						{status === "loading" && (
							<div className="popup-state popup-state--loading">
								<div className="spinner" aria-hidden="true" />
								<p className="popup-state__message">{t.loading}</p>
							</div>
						)}

						{status === "excluded_site" && (
							<div className="popup-state popup-state--empty popup-state--excluded">
								<div className="popup-state__icon">🚫</div>
								<h2 className="popup-state__title">{t.excludedSiteTitle}</h2>
								<p className="popup-state__desc">{t.excludedSiteDesc}</p>
								<button
									type="button"
									className="popup-btn popup-btn--secondary"
									style={{ marginTop: 16 }}
									onClick={() => setShowSettings(true)}
								>
									{t.manageExcludedSites}
								</button>
							</div>
						)}

						{status === "unsupported_page" && (
							<div className="popup-state popup-state--empty">
								<div className="popup-state__icon">🔒</div>
								<h2 className="popup-state__title">{t.unsupportedPageTitle}</h2>
								<p className="popup-state__desc">{t.unsupportedPageDesc}</p>
								<button
									type="button"
									className="popup-btn popup-btn--primary"
									style={{ marginTop: 16 }}
									onClick={runScan}
								>
									{t.retry}
								</button>
							</div>
						)}

						{status === "no_candidates" && (
							<div className="popup-empty-container">
								<div className="popup-empty-notice">
									<span className="popup-empty-notice__icon">🔍</span>
									<div className="popup-empty-notice__text">
										<h2 className="popup-empty-notice__title">
											{t.noCandidatesTitle}
										</h2>
										<p className="popup-empty-notice__desc">
											{t.noCandidatesDesc}
										</p>
									</div>
								</div>
							</div>
						)}

						{status === "error" && (
							<div className="popup-state popup-state--error">
								<div className="popup-state__icon">⚠️</div>
								<h2 className="popup-state__title">{t.errorTitle}</h2>
								<p className="popup-state__desc">
									{errorMessage || t.errorDesc}
								</p>
								<button
									type="button"
									className="popup-btn popup-btn--primary"
									onClick={runScan}
								>
									{t.retry}
								</button>
							</div>
						)}

						{status === "results" && (
							<div className="popup-results">
								<CodeList
									candidates={candidates}
									t={t}
									locale={locale}
									selectedCode={previewCode}
									onPreview={setPreviewCode}
									favorites={favorites}
									onToggleFavorite={handleToggleFavorite}
								/>
							</div>
						)}
					</>
				)}
			</main>
		</div>
	);
};
