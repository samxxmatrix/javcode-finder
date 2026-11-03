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
import { buildUncensoredRules } from "../../src/lib/uncensored-code";
import {
	FAVORITES_STORAGE_KEY,
	loadFavorites,
	orderFavoritesForView,
	parseFavorites,
	parseStoredFavorites,
	saveFavorites,
	serializeFavorites,
	toggleFavorite,
} from "../../src/lib/favorites";
import { messages } from "../../src/lib/locales";
import { markCodesForTab } from "../../src/lib/mark-codes";
import { normalizeCode } from "../../src/lib/normalize-code";
import { pickSearchCode } from "../../src/lib/pick-search-code";
import {
	isNewerVersion,
	readUpdateState,
	resolveCheckOutcome,
	shouldCheckForUpdate,
	shouldShowUpdate,
	writeUpdateState,
	type AvailableUpdate,
	type UpdateCheckResponse,
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
import {
	SettingsView,
	type UpdateCheckInfo,
} from "./components/SettingsView";
import { TrailerPreview } from "./components/TrailerPreview";

/** 版本检查状态（不含 App 注入的回调）；设置页只读这份数据 */
type UpdateCheckState = Omit<UpdateCheckInfo, "onCheck">;

export const App: React.FC = () => {
	const [locale, setLocale] = useState<SupportedLocale>(() =>
		getEffectiveLocale(),
	);
	const t = messages[locale];
	// 已装版本：远端版本比较、更新提示与设置页展示都以它为准
	const currentVersion = browser.runtime.getManifest().version;

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
	// 收藏的番号列表（本地 storage 为准，云端为镜像）
	const [favorites, setFavorites] = useState<string[]>([]);
	// 收藏夹模式：true 时列表显示收藏、页面扫描失效
	const [favoritesMode, setFavoritesMode] = useState(false);
	// runScan 在异步/事件回调里同步判断模式，避免闭包读到陈旧 state
	const favoritesModeRef = useRef(false);
	// 收藏夹视图顺序：存储是旧→新，展示取倒序（新→旧），引用稳定供分页依赖
	const favoritesViewCodes = React.useMemo(
		() => orderFavoritesForView(favorites),
		[favorites],
	);
	// 已在 Emby 库中的番号（归一化形式），空集合 = 不显示任何标识
	const [inLibrary, setInLibrary] = useState<Set<string>>(() => new Set());
	const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(
		null,
	);
	// 版本检查状态：App 是唯一请求方与 storage 写入方，避免与设置页双写互相覆盖。
	// 初值直接读缓存，设置页一打开就能显示上次查到的版本，不必等网络。
	const [updateCheck, setUpdateCheck] = useState<UpdateCheckState>(() => {
		const stored = readUpdateState(getStorage());
		return {
			status: stored.remote
				? isNewerVersion(stored.remote.version, currentVersion)
					? "update"
					: "latest"
				: "idle",
			remoteVersion: stored.remote?.version ?? null,
			downloadUrl: stored.remote?.url ?? null,
			checkedAt: stored.checkedAt,
		};
	});
	// 云端推送防抖计时器（合并连续收藏操作，降低请求频率）
	const cloudPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// 导航完成后延迟扫描计时器（等待新文档稳定）与空结果补扫计时器
	const navScanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const rescanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Emby 刷新请求序号：新一轮扫描递增，迟到的旧刷新据此放弃写入（防止覆盖新图标）
	const embyRefreshIdRef = useRef(0);
	// 本轮扫描页面标记的 promise 与目标 tab：Emby 在库结果晚到，重绘必须等首次标记先落地
	const markDoneRef = useRef<Promise<void> | null>(null);
	const markTabIdRef = useRef<number | undefined>(undefined);

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
				// 无码规则快照只在开关打开时注入：关闭时传 null，页面里一行无码逻辑都不走
				// （注入函数不能 import，规则只能这样当参数带过去）
				args: [
					settings.customRegex || DEFAULT_CODE_REGEX,
					settings.d2passEnabled
						? buildUncensoredRules(settings.codeExcludeRegex)
						: null,
					// 全局黑名单与 D2PASS 开关无关：无论开关都传入，D2PASS 关闭时仍压有码误报
					settings.codeExcludeRegex,
				],
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

	// Emby 在库结果晚于页面标记到达：把命中的番号就地换成 Emby 图标（黄点/书签让位）。
	// 先等首次标记注入完成再重绘 —— 冷启动时 Emby 结果可能先到，顺序反了就永远没有图标。
	const recolorEmbyMarks = async (codes: Set<string>): Promise<void> => {
		const tabId = markTabIdRef.current;
		if (tabId === undefined) return;
		const markDone = markDoneRef.current;
		if (markDone) {
			try {
				await markDone;
			} catch {
				// 首次注入失败（受限页面等）：无标记可改，静默放弃
				return;
			}
		}
		// codes 传空：recolor 模式不插入/不清理，只按命中的已有标记重绘。
		// 收藏集传空数组而不是 undefined —— executeScript 的 args 不允许 undefined
		await markCodesForTab(tabId, [], 30, [], {
			codes: [...codes],
			recolor: true,
		});
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
				const next = new Set(
					checked.matched.map((code) => normalizeCode(code)),
				);
				setInLibrary(next);
				// 页面标记同步升级：命中库的番号显示 Emby 图标
				if (next.size > 0) void recolorEmbyMarks(next);
			}
			// 逐条查询失败：保留现有标识，不因为一次抖动清空
			return;
		}
		// index 为 null = fail closed（无可用索引）：清空标识，不保留上一轮的
		const next = res.index
			? matchEmbyCodes(res.index.keys, codes)
			: new Set<string>();
		setInLibrary(next);
		// 只升不降：集合为空时页面标记保持首次注入的黄点/书签
		if (next.size > 0) void recolorEmbyMarks(next);
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
				// 该番号在页面上有标记就跟着升级为 Emby 图标（recolor 只升不降）
				void recolorEmbyMarks(new Set([code]));
			}
			return;
		}
		if (res.index && matchEmbyCodes(res.index.keys, [code]).has(code)) {
			// 只增不减：不要因为一次手动查询把列表已有的标识覆盖掉
			setInLibrary((prev) => new Set(prev).add(code));
			void recolorEmbyMarks(new Set([code]));
		}
	};

	const runScan = async (isRescan = false) => {
		// 收藏夹模式下页面扫描无效：防止标签页导航等后台扫描用扫描页结果覆盖收藏夹的在库标识
		if (favoritesModeRef.current) return;
		setStatus("loading");
		setErrorMessage(null);
		setCandidates([]);
		setTruncated(false);
		// 注意：**不清空 previewCode**。预览组件以 previewCode 为 key，清空即卸载播放器、
		// 中断正在播放的视频。刷新/切换页面触发的重新扫描只更新下方候选列表、不动预览；
		// 预览只在用户点关闭（onClose）或切到别的番号（onPreview 换 key）时卸载。
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

			// 扫描进行中用户切到收藏夹：丢弃本次结果，避免覆盖收藏夹视图的在库标识
			if (favoritesModeRef.current) return;

			// 扫描后同步页面标记：有候选则标记（命中收藏的番号显示书签图标），
			// 无候选/排除/不支持时仅清理旧标记；收藏读 storage 最新值，不依赖 state
			if (extraction.tabId !== undefined) {
				const codes = extraction.candidates;
				// 记下首次注入的 promise 与目标 tab：Emby 在库结果晚到时要等它之后补一次重绘
				markTabIdRef.current = extraction.tabId;
				markDoneRef.current = markCodesForTab(
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

	// 顶部输入框查询：与点击列表项/网页圆点同一流程，直接展开对应番号的预览。
	// 输入先经 pickSearchCode 抽取（有码 + 无码两路，与页面扫描同口径）：
	// 用户粘进来的可能是「任务名称:-MFYD-189」这种带标签的文本，照抄会让后端把脏串当缓存键。
	const handleSearch = () => {
		const code = pickSearchCode(searchInput, getSettings().customRegex);
		if (!code) return;
		setPreviewCode(code);
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
		const wasFavorite = favorites.includes(code);
		const next = toggleFavorite(favorites, code);
		setFavorites(next);
		// 本地写入失败仅保留内存状态；云端推送照常执行
		saveFavorites(getStorage(), next);
		// 收藏夹模式内「新收藏」的项：复用单码查询实时补齐 Emby 在库标识（不重扫页面）。
		// 取消收藏不调用：该项退出列表即可，残留条目下次进模式整集重算纠正。
		if (!wasFavorite && favoritesModeRef.current) {
			void ensureEmbyCode(code);
		}
		if (cloudPushTimerRef.current) clearTimeout(cloudPushTimerRef.current);
		cloudPushTimerRef.current = setTimeout(() => {
			void pushToCloud(next);
		}, 2000);
	};

	// 切换收藏夹模式：进入不扫描（效果里按收藏集重算 Emby 在库）；退出恢复扫描目标页
	const handleToggleFavoritesMode = () => {
		const next = !favoritesModeRef.current;
		favoritesModeRef.current = next;
		setFavoritesMode(next);
		if (!next) void runScan();
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

	// 进入收藏夹：按完整收藏集重算 Emby 在库（与渲染多少条无关）。
	// 退出时不在效果里处理，runScan 负责恢复扫描页标识。
	const favoritesRef = useRef(favorites);
	favoritesRef.current = favorites;
	useEffect(() => {
		if (!favoritesMode) return;
		embyRefreshIdRef.current++;
		setInLibrary(new Set());
		void refreshEmbyIndex(favoritesRef.current);
	}, [favoritesMode]);

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

	// 版本更新检查：24h 节流与关闭记忆都持久化在 localStorage（见 src/lib/release.ts）。
	// force=true 时绕过节流（设置页「检查更新」）；失败**不写 checkedAt**，可立即重试。
	const runUpdateCheck = async (force: boolean) => {
		const storage = getStorage();
		const stored = readUpdateState(storage);

		if (!force && !shouldCheckForUpdate(stored, Date.now())) {
			setUpdateCheck({
				status: stored.remote
					? isNewerVersion(stored.remote.version, currentVersion)
						? "update"
						: "latest"
					: "idle",
				remoteVersion: stored.remote?.version ?? null,
				downloadUrl: stored.remote?.url ?? null,
				checkedAt: stored.checkedAt,
			});
			setAvailableUpdate(
				shouldShowUpdate(stored, currentVersion) ? stored.remote : null,
			);
			return;
		}

		setUpdateCheck((prev) => ({ ...prev, status: "checking" }));
		let response: UpdateCheckResponse | undefined;
		try {
			response = (await browser.runtime.sendMessage({
				type: "jt:check-update",
			})) as UpdateCheckResponse | undefined;
		} catch {
			response = undefined;
		}

		const outcome = resolveCheckOutcome(response, currentVersion);
		if (outcome.status === "error") {
			// 关键：失败不推进 checkedAt，否则一次网络抖动就要等 24h 才能重试
			setUpdateCheck((prev) => ({ ...prev, status: "error" }));
			return;
		}

		// read-modify-write：只覆盖自己负责的字段，保住用户关掉提示的记忆（dismissedVersion）
		const next = { ...stored, checkedAt: Date.now(), remote: outcome.remote };
		writeUpdateState(storage, next);
		setUpdateCheck({
			status: outcome.status,
			remoteVersion: outcome.remote?.version ?? null,
			downloadUrl: outcome.remote?.url ?? null,
			checkedAt: next.checkedAt,
		});
		setAvailableUpdate(
			shouldShowUpdate(next, currentVersion) ? outcome.remote : null,
		);
	};

	// 面板挂载时检查一次（受 24h 节流约束）；手动检查由设置页按钮触发 force
	useEffect(() => {
		void runUpdateCheck(false);
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

	// 长连接让 background 感知面板开关（关闭时清理页面标识）。
	// MV3 后台会被回收：端口随之断开、background 侧的 onDisconnect 也一并消失。
	// 不重连的话，后台重启后再关闭面板就没有任何清理回调，页面标识会残留。
	useEffect(() => {
		if (!boundTabId) return;
		if (typeof browser === "undefined" || !browser.runtime?.connect) return;
		let disposed = false;
		let retryTimer: ReturnType<typeof setTimeout> | null = null;
		let port: ReturnType<typeof browser.runtime.connect> | null = null;

		const connect = () => {
			if (disposed) return;
			try {
				port = browser.runtime.connect({ name: `sidepanel:${boundTabId}` });
			} catch {
				// 扩展上下文已失效（重载/更新），重试无意义
				return;
			}
			port.onDisconnect.addListener(() => {
				// 组件卸载是主动断开，不重连；后台被回收导致的中断则重连，恢复开关感知
				if (disposed) return;
				retryTimer = setTimeout(connect, 500);
			});
		};
		connect();

		// 文档销毁（关闭面板）时兜底通知一次：不依赖端口当时是否仍存活
		const handlePageHide = () => {
			try {
				void browser.runtime
					.sendMessage({ type: "jt:panel-closing", tabId: boundTabId })
					.catch(() => {});
			} catch {
				// 上下文即将销毁，忽略
			}
		};
		window.addEventListener("pagehide", handlePageHide);

		return () => {
			disposed = true;
			if (retryTimer) clearTimeout(retryTimer);
			window.removeEventListener("pagehide", handlePageHide);
			try {
				port?.disconnect();
			} catch {
				// Ignore port connection errors
			}
		};
	}, [boundTabId]);

	useEffect(() => {
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
					{!showSettings && !favoritesMode && (
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
						onClick={() => {
							setShowSettings(!showSettings);
						}}
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

			{truncated && !showSettings && !favoritesMode && (
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
						locale={locale}
						t={t}
						onBack={() => {
							setShowSettings(false);
							runScan();
						}}
						onLocaleChange={(newLocale) => setLocale(newLocale)}
						// 版本检查：展示 App 持有的缓存结果，按钮触发 force 检查
						updateCheck={{
							status: updateCheck.status,
							remoteVersion: updateCheck.remoteVersion,
							downloadUrl: updateCheck.downloadUrl,
							checkedAt: updateCheck.checkedAt,
							onCheck: () => void runUpdateCheck(true),
						}}
						// 云端开通：本地空 → 拉取云端；本地有 → 立即推送备份
						onWebdavConnected={() => {
							// 云端开通：本地空 → 拉取云端；本地有 → 立即推送备份
							if (favorites.length === 0) {
								void pullFromCloud();
							} else {
								void pushToCloud(favorites);
							}
						}}
					/>

				) : favoritesMode ? (
					<div className="popup-results">
						<CodeList
							candidates={favoritesViewCodes}
							t={t}
							locale={locale}
							selectedCode={previewCode}
							onPreview={setPreviewCode}
							favorites={favorites}
							onToggleFavorite={handleToggleFavorite}
							inLibrary={inLibrary}
							favoritesMode
							onToggleFavoritesMode={handleToggleFavoritesMode}
						/>
					</div>
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
									favoritesMode={false}
									onToggleFavoritesMode={handleToggleFavoritesMode}
								/>
							</div>
						)}
					</>
				)}
			</main>
		</div>
	);
};
