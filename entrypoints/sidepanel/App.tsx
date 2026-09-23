import React, { useEffect, useState } from "react";
import { extractCandidatesInTab } from "../../src/lib/extract-codes";
import { messages } from "../../src/lib/locales";
import {
	DEFAULT_CODE_REGEX,
	getEffectiveLocale,
	getSettings,
	isHostExcluded,
} from "../../src/lib/settings";
import type {
	ExtractionResult,
	PopupStatus,
	SupportedLocale,
} from "../../src/lib/types";
import { CodeList } from "./components/CodeList";
import { SettingsView } from "./components/SettingsView";
import { TrailerPreview } from "./components/TrailerPreview";
import { UpdateNotice } from "../shared/UpdateNotice";

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
			<UpdateNotice t={t} />

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
						t={t}
						onClose={() => setPreviewCode(null)}
					/>
				)}
				{showSettings ? (
					<SettingsView
						locale={locale}
						t={t}
						onBack={() => {
							setShowSettings(false);
							runScan();
						}}
						onLocaleChange={(newLocale) => setLocale(newLocale)}
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
								<div className="popup-results__bar">
									<span className="popup-results__summary">
										{t.summary(candidates.length)}
									</span>
								</div>
								<CodeList
									candidates={candidates}
									t={t}
									locale={locale}
									selectedCode={previewCode}
									onPreview={setPreviewCode}
								/>
							</div>
						)}
					</>
				)}
			</main>
		</div>
	);
};
