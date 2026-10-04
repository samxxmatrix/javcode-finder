import React, { useEffect, useRef, useState } from "react";
import {
	type EmbyIndex,
	embyRegexKey,
	embyServerKey,
	isEmbyIndexFresh,
	matchEmbyCodes,
} from "../../src/lib/emby";
import { browserEmbyStore, loadEmbyIndex } from "../../src/lib/emby-index";
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
import { markCodesForTab } from "../../src/lib/mark-codes";
import { normalizeCode } from "../../src/lib/normalize-code";
import {
	readUpdateState,
	shouldCheckForUpdate,
	shouldShowUpdate,
	writeUpdateState,
	type AvailableUpdate,
} from "../../src/lib/release";
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
import { ClearButton } from "./components/ClearButton";
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
	// 顶部查询输入框内容
	const [searchInput, setSearchInput] = useState("");
	// 顶部图标按钮调用设置页的保存/重置
	const settingsRef = useRef<SettingsViewHandle>(null);
	// 收藏的番号列表（本地 storage 为准，云端为镜像）
	const [favorites, setFavorites] = useState<string[]>([]);
	// 已在 Emby 库中的番号（归一化形式），空集合 = 不显示任何标识
	const [inLibrary, setInLibrary] = useState<Set<string>>(() => new Set());
	const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(
		null,
	);
	// 云端推送防抖计时器（合并连续收藏操作，降低请求频率）
	const cloudPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// 导航完成后延迟扫描计时器（等待新文档稳定）与空结果补扫计时器
	const navScanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const rescanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Emby 刷新请求序号：新一轮扫描递增，迟到的旧刷新据此放弃写入（防止覆盖新图标）
	const embyRefreshIdRef = useRef(0);

	// 获取面板目标的标签页：优先绑定 tab，否则当前窗口活动 tab
	const getTargetTab = async (): Promise<
		{ id?: number; url?: string } | undefined
	> => {
		let targetTab: { id?: number; url?: string } | undefined;
		if (boundTabId) {
			try {
				targetTab = await browser.tabs.get(boundTabId);
			} catch {
				// Bound tab might have closed or cannot be retrieved
			}
		}
		if (!targetTab) {
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
			targetTab = tabs && tabs.length > 0 ? tabs[0] : undefined;
		}
		return targetTab;
	};

	// 提取目标标签页的番号候选；tabId 供后续在同一标签页上标记圆点
	const extractFromActiveTab = async (
		settings: ReturnType<typeof getSettings>,
	): Promise<ExtractionResult & { excluded?: boolean; tabId?: number }> => {
		const activeTab = await getTargetTab();
		if (!activeTab || !activeTab.id) {
			return { candidates: [], truncated: false, unsupported: true };
		}

		const url = activeTab.url || "";
		if (isHostExcluded(url, settings.excludedHosts)) {
			return {
				candidates: [],
				truncated: false,
				excluded: true,
				tabId: activeTab.id,
			};
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
			return {
				candidates: [],
				truncated: false,
				unsupported: true,
				tabId: activeTab.id,
			};
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
				return { candidates: [], truncated: false, tabId: activeTab.id };
			}

			return {
				...(firstResult as ExtractionResult),
				tabId: activeTab.id,
			};
		} catch (err) {
			console.warn("ExecuteScript failed on tab:", activeTab.id, err);
			return {
				candidates: [],
				truncated: false,
				unsupported: true,
				tabId: activeTab.id,
			};
		}
	};

	// 当前生效的番号正则（与扫描用的一致，决定索引键口径）
	const activeRegex = (): string => {
		const settings = getSettings();
		return settings.customRegex || DEFAULT_CODE_REGEX;
	};

	// 取索引：TTL 内直接复用；否则让 background 同步（background 负责落盘）。
	// 返回 null 表示「本轮不该写状态」：未启用 Emby，或被更新的一轮请求号作废（本轮已过期）。
	// 返回 { index: null } 表示「索引不可用」（无索引/服务器或正则指纹不符/同步失败且无可用旧索引）：
	// fail closed，调用方不得据此匹配；整页刷新据此清空旧标识。
	// 返回 tooLarge = 媒体库过大无法建全量索引，由调用方按需发 jt:emby-check 逐条查询。
	// newRound=true（整页刷新）开启新一轮请求号，作废在途的旧刷新，防止旧结果覆盖新图标；
	// 补充查询（单个番号）传 false：它「只增不减」，不该把在途的整页刷新作废（否则列表标识会被吞掉）。
	const loadOrSyncIndex = async (
		newRound = true,
	): Promise<
		| {
				index: EmbyIndex | null;
				tooLarge: boolean;
				/** 供调用方在自己的 await（额外的 jt:emby-check）之后再验一次本轮是否仍有效 */
				stillCurrent: () => boolean;
		  }
		| null
	> => {
		// 本轮刷新序号：任何 await 之后发现已有更新的一轮（或扫描已作废本轮）就放弃写入
		const requestId = newRound
			? ++embyRefreshIdRef.current
			: embyRefreshIdRef.current;
		const settings = getSettings();
		if (!settings.embyEnabled) return null;
		const regex = activeRegex();
		const regexKey = embyRegexKey(regex);
		// serverKey 参与新鲜度判定：换服务器/改 Key 后旧索引立即失效，不会拿旧库的图标
		const serverKey = embyServerKey(settings.embyUrl, settings.embyApiKey);
		// 在途期间设置可能被改动：await 之后既要比请求号，也要比当前服务器指纹
		const stillCurrent = (): boolean => {
			if (requestId !== embyRefreshIdRef.current) return false;
			const latest = getSettings();
			return (
				latest.embyEnabled &&
				embyServerKey(latest.embyUrl, latest.embyApiKey) === serverKey
			);
		};
		let index = await loadEmbyIndex(browserEmbyStore());
		if (!stillCurrent()) return null;
		if (!isEmbyIndexFresh(index, Date.now(), serverKey, regexKey)) {
			try {
				const res = (await browser.runtime.sendMessage({
					type: "jt:emby-sync",
					embyUrl: settings.embyUrl,
					embyApiKey: settings.embyApiKey,
					regex,
				})) as
					| {
							ok?: boolean;
							mode?: string;
							serverKey?: string;
							syncedAt?: number;
							fullSyncedAt?: number;
							total?: number;
							keys?: string[];
					  }
					| undefined;
				if (!stillCurrent()) return null;
				if (res?.ok && res.mode === "too-large") {
					// 库太大：放弃全量索引，改由调用方逐条查询（并发 4，background 内复核）。
					// 这里不写 inLibrary：整页刷新与单番号查询的写入语义不同。
					return { index: null, tooLarge: true, stillCurrent };
				}
				if (res?.ok && Array.isArray(res.keys)) {
					// background 已把同一份索引写入 storage.local，这里只用于本次匹配
					index = {
						v: 1,
						serverKey: res.serverKey ?? "",
						regexKey,
						syncedAt: res.syncedAt ?? Date.now(),
						fullSyncedAt: res.fullSyncedAt ?? res.syncedAt ?? Date.now(),
						total: res.total ?? res.keys.length,
						keys: res.keys,
					};
				}
			} catch (err) {
				// 同步失败：沿用旧索引（宁可略旧，也不要把在库判成不在库）
				console.warn("[JavCode Finder] Emby 同步失败:", err);
			}
		}
		if (!stillCurrent()) return null;
		// fail closed：空指纹、索引来自别的服务器、或生效正则已变（键口径漂移）时一律不匹配
		if (
			!serverKey ||
			!index ||
			index.serverKey !== serverKey ||
			index.regexKey !== regexKey
		) {
			return { index: null, tooLarge: false, stillCurrent };
		}
		return { index, tooLarge: false, stillCurrent };
	};

	// 整页候选的在库判定：拿索引后整体替换标识集（未启用 Emby 或没有候选时清空）
	const refreshEmbyIndex = async (codes: string[]): Promise<void> => {
		const settings = getSettings();
		if (!settings.embyEnabled || codes.length === 0) {
			setInLibrary(new Set());
			return;
		}
		const res = await loadOrSyncIndex();
		// 本轮已被更新的刷新取代：什么都不写，交给新一轮
		if (!res) return;
		if (res.tooLarge) {
			// 超大库：逐条查询（并发 4，background 内复核）
			const checked = (await browser.runtime.sendMessage({
				type: "jt:emby-check",
				embyUrl: settings.embyUrl,
				embyApiKey: settings.embyApiKey,
				regex: activeRegex(),
				codes,
			})) as { ok?: boolean; matched?: string[] } | undefined;
			if (!res.stillCurrent()) return;
			if (checked?.ok === true && Array.isArray(checked.matched)) {
				// background 回传的是面板发出的原始候选写法，这里统一归一化后再入库
				setInLibrary(
					new Set(checked.matched.map((code) => normalizeCode(code))),
				);
			}
			// 逐条查询失败：保留现有标识，不因为一次抖动清空
			return;
		}
		// index 为 null = fail closed（无可用索引）：清空标识，不保留上一轮的
		setInLibrary(res.index ? matchEmbyCodes(res.index.keys, codes) : new Set());
	};

	// 顶部搜索框/手动查询的番号不在当前页候选里，单独按索引查一次（本地匹配，不额外联网）
	const ensureEmbyCode = async (rawCode: string): Promise<void> => {
		const settings = getSettings();
		const code = normalizeCode(rawCode);
		if (!settings.embyEnabled || !code) return;
		// 已在集合里就不必再查（读的是本次渲染的闭包值；多查一次也只是本地匹配，无害）
		if (inLibrary.has(code)) return;
		// 补充查询不作废在途的整页刷新
		const res = await loadOrSyncIndex(false);
		if (!res) return;
		if (res.tooLarge) {
			// 超大库：只查这一个番号
			const checked = (await browser.runtime.sendMessage({
				type: "jt:emby-check",
				embyUrl: settings.embyUrl,
				embyApiKey: settings.embyApiKey,
				regex: activeRegex(),
				codes: [code],
			})) as { ok?: boolean; matched?: string[] } | undefined;
			if (!res.stillCurrent()) return;
			if (
				checked?.ok === true &&
				(checked.matched ?? []).some((m) => normalizeCode(m) === code)
			) {
				setInLibrary((prev) => new Set(prev).add(code));
			}
			return;
		}
		if (res.index && matchEmbyCodes(res.index.keys, [code]).has(code)) {
			// 只增不减：不要因为一次手动查询把列表已有的标识覆盖掉
			setInLibrary((prev) => new Set(prev).add(code));
		}
	};

	const runScan = async (isRescan = false) => {
		setStatus("loading");
		setErrorMessage(null);
		setCandidates([]);
		setTruncated(false);
		setPreviewCode(null);
		// 清掉上一页的在库标识（并作废仍在途的 Emby 刷新，避免旧结果回填）
		embyRefreshIdRef.current++;
		setInLibrary(new Set());
		// 新一轮扫描作废未执行的延迟/补扫计时器
		if (navScanTimerRef.current) clearTimeout(navScanTimerRef.current);
		if (rescanTimerRef.current) clearTimeout(rescanTimerRef.current);

		const settings = getSettings();

		try {
			// 发起扫描前记录目标 tab 的 URL，扫描完成后若已变化（导航竞态），结果作废重扫
			const tabBefore = await getTargetTab();
			const extraction = await extractFromActiveTab(settings);
			const tabAfter = await getTargetTab();
			if (
				tabBefore?.url &&
				tabAfter?.url &&
				tabBefore.url !== tabAfter.url
			) {
				void runScan();
				return;
			}

			// 扫描后同步页面标记：有候选则标记（命中收藏的番号显示书签图标），
			// 无候选/排除/不支持时仅清理旧标记；收藏读 storage 最新值，不依赖 state
			if (extraction.tabId !== undefined) {
				const codes = extraction.candidates;
				void markCodesForTab(
					extraction.tabId,
					codes.length > 0 ? codes : [],
					30,
					codes.length > 0 ? loadFavorites(getStorage()) : [],
				);
			}

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
			// 在库判定不阻塞列表渲染：先出结果，命中后补图标
			void refreshEmbyIndex(extraction.candidates);

			setStatus(
				extraction.candidates.length === 0 ? "no_candidates" : "results",
			);

			// 空结果补扫：客户端渲染/懒加载的页面 DOM 可能未就绪，
			// 主扫描（非补扫）为空时 1.5s 后补扫一次；补扫后仍空则停止，避免无限循环
			if (!isRescan && extraction.candidates.length === 0) {
				rescanTimerRef.current = setTimeout(() => {
					void runScan(true);
				}, 1500);
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			setErrorMessage(msg);
			setStatus("error");
		}
	};

	const handleRefresh = async () => {
		await runScan();
	};

	// 顶部输入框查询：与点击列表项/网页圆点同一流程，直接展开对应番号的预览
	const handleSearch = () => {
		const code = searchInput.trim();
		if (!code) return;
		setPreviewCode(normalizeCode(code));
	};

	// 从云端拉取收藏并覆盖本地（仅本地为空时调用，避免覆盖较新的本地数据）；
	// 开关关闭时不存取云端
	const pullFromCloud = async (): Promise<void> => {
		const s = getSettings();
		if (!s.webdavEnabled) return;
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

	// 推送收藏到云端（整体覆盖；失败静默，下一次成功推送自动补偿）；开关关闭时不存取云端
	const pushToCloud = async (codes: string[]): Promise<void> => {
		const s = getSettings();
		if (!s.webdavEnabled) return;
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

	// 页面圆点点击消息：面板开着且消息来自绑定标签页时打开该番号预览
	useEffect(() => {
		const listener = (message: unknown, sender: unknown) => {
			const msg = message as { type?: string; code?: string } | undefined;
			const s = sender as
				| { tab?: { id?: number; active?: boolean } }
				| undefined;
			if (msg?.type !== "jt:code-clicked" || !msg.code) return;
			// 绑定模式下只响应绑定标签页；未绑定（兜底路径）时只响应当前活动标签页
			const tabMatches = boundTabId
				? s?.tab?.id === boundTabId
				: s?.tab?.active === true;
			if (!tabMatches) return;
			setPreviewCode(msg.code);
		};

		if (typeof browser !== "undefined" && browser.runtime?.onMessage) {
			browser.runtime.onMessage.addListener(listener);
		}
		return () => {
			if (typeof browser !== "undefined" && browser.runtime?.onMessage) {
				browser.runtime.onMessage.removeListener(listener);
			}
		};
	}, [boundTabId]);

	// 版本更新检查：24h 节流 + 关闭记忆都持久化在 localStorage（见 src/lib/release.ts）。
	// 失败静默且**不写 checkedAt**，下次打开面板再试；节流期内复用上次查到的结果。
	useEffect(() => {
		const storage = getStorage();
		const state = readUpdateState(storage);
		if (!shouldCheckForUpdate(state, Date.now())) {
			if (shouldShowUpdate(state)) setAvailableUpdate(state.latest);
			return;
		}
		void (async () => {
			try {
				const res = (await browser.runtime.sendMessage({
					type: "jt:check-update",
				})) as { update?: AvailableUpdate | null } | undefined;
				const latest = res?.update ?? null;
				const next = { ...state, checkedAt: Date.now(), latest };
				writeUpdateState(storage, next);
				if (shouldShowUpdate(next)) setAvailableUpdate(latest);
			} catch {
				// 检查失败：保持原状态，不打扰用户
			}
		})();
	}, []);

	const dismissUpdate = () => {
		if (!availableUpdate) return;
		const storage = getStorage();
		writeUpdateState(storage, {
			...readUpdateState(storage),
			dismissedVersion: availableUpdate.version,
		});
		setAvailableUpdate(null);
	};

	// 预览的番号（搜索框手输/点列表/网页圆点）不一定在「当前页候选」里，
	// 所以这里按预览番号单独补查一次在库状态；已在集合里的会在 ensureEmbyCode 内提前返回。
	// 依赖只有 previewCode：inLibrary 不能进依赖，否则写入后重跑形成自激循环。
	useEffect(() => {
		if (!previewCode) return;
		void ensureEmbyCode(previewCode);
	}, [previewCode]);

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
				// 延迟 500ms 扫描：等待导航完全稳定、新文档就绪（避免扫描到旧文档）
				navScanTimerRef.current = setTimeout(() => {
					void runScan();
				}, 500);
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
			if (navScanTimerRef.current) clearTimeout(navScanTimerRef.current);
			if (rescanTimerRef.current) clearTimeout(rescanTimerRef.current);
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
				{!showSettings && (
					<div className="popup-header__search">
						<div className="popup-header__search-input-wrap">
							<input
								type="text"
								className="popup-header__search-input"
								value={searchInput}
								onChange={(e) => setSearchInput(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleSearch();
								}}
								placeholder={t.searchCodePlaceholder}
								aria-label={t.searchCodeLabel}
							/>
							<ClearButton
								show={Boolean(searchInput)}
								onClick={() => setSearchInput("")}
								title={t.clearInput}
							/>
						</div>
						<button
							type="button"
							className="popup-header__icon-btn"
							onClick={handleSearch}
							title={t.searchCodeLabel}
							aria-label={t.searchCodeLabel}
						>
							<svg
								viewBox="0 0 1024 1024"
								fill="currentColor"
								width="16"
								height="16"
								aria-hidden="true"
							>
								<path d="M609.376 654.816A239.264 239.264 0 0 1 464 704a240 240 0 1 1 240-240 239.264 239.264 0 0 1-49.472 145.728L790.4 745.6A32 32 0 0 1 768 800a32 32 0 0 1-22.72-9.28l-135.904-135.904zM464 288a176 176 0 1 0 176 176A176.32 176.32 0 0 0 464 288z" />
							</svg>
						</button>
					</div>
				)}
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

			{availableUpdate && (
				<div className="popup-update-notice" role="status">
					<a
						className="popup-update-notice__link"
						href={availableUpdate.url}
						target="_blank"
						rel="noopener noreferrer"
						aria-label={t.updateAvailableAria(availableUpdate.version)}
					>
						<span className="popup-update-notice__copy">
							<strong>
								{t.updateAvailableTitle(availableUpdate.version)}
							</strong>
							<span>{t.updateAvailableDesc}</span>
						</span>
						<span className="popup-update-notice__action">{t.updateNow}</span>
					</a>
					<button
						type="button"
						className="popup-update-notice__close"
						onClick={dismissUpdate}
						aria-label={t.closeError}
						title={t.closeError}
					>
						×
					</button>
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
						inLibrary={inLibrary.has(normalizeCode(previewCode))}
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
						// Emby 开关立即生效：重扫当前页，索引就绪后立刻补上在库标识
						onEmbyChange={() => void runScan()}
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
									onClick={() => void runScan()}
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
									onClick={() => void runScan()}
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
									inLibrary={inLibrary}
								/>
							</div>
						)}
					</>
				)}
			</main>
		</div>
	);
};
