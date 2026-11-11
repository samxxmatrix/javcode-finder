import { useEffect, useRef, useState } from "react";
import type { LocaleMessages } from "../../../../src/lib/locales";
import {
	configSignature,
	DEFAULT_CODE_REGEX,
	DEFAULT_SETTINGS,
	getEffectiveLocale,
	getSavedLocale,
	getSettings,
	getStorage,
	isValidRegex,
	normalizeDomain,
	resetSettings,
	saveLocale,
	saveSettings,
	type ExtensionSettings,
	type LocaleOption,
	type ThemeOption,
} from "../../../../src/lib/settings";
import type { SupportedLocale } from "../../../../src/lib/types";
import {
	classifyWebdavVerify,
	loadFavorites,
	saveFavorites,
	serializeFavorites,
	splitFavoritesByLibrary,
	type WebdavVerifyResult,
} from "../../../../src/lib/favorites";
import {
	decideCloudSettingsAction,
	mergeCloudSettings,
	parseCloudSettings,
	serializeCloudSettings,
	type CloudSettings,
} from "../../../../src/lib/settings-sync";
import type { FallbackService } from "../../../../src/lib/translate";
import { normalizePrefix } from "../../../../src/lib/faleno";
import { browserEmbyStore, loadEmbyIndex } from "../../../../src/lib/emby-index";
import { embyServerKey } from "../../../../src/lib/emby";

/** 本地落盘的防抖时长：连续输入时只在停顿后写一次存储 */
const SAVE_DEBOUNCE_MS = 400;
/** 云端推送的防抖时长：比本地更长，避免每个字符都打一次 WebDAV */
const CLOUD_DEBOUNCE_MS = 1500;

interface UseSettingsDraftOptions {
	locale: SupportedLocale;
	t: LocaleMessages;
	onLocaleChange?: (locale: SupportedLocale) => void;
	onWebdavConnected?: () => void;
	/**
	 * 清理完「已在库」收藏后回传**清理后的完整收藏列表**。
	 * 设置页与主面板是同一个页面：本页写 localStorage 不会触发 storage 事件，
	 * 不同步回主面板就会留下一份已经删掉的收藏状态。
	 */
	onFavoritesPurged?: (codes: string[]) => void;
}

/** 从 background 返回的错误串（形如 "HTTP 403"）里取状态码；取不到返回 0 */
function httpStatusOf(error: string): number {
	const matched = /HTTP\s+(\d{3})/.exec(error || "");
	return matched ? Number(matched[1]) : 0;
}

/**
 * 设置页的唯一状态源：所有字段、开关校验、云端同步与「修改即保存」都收敛在这里。
 * 页面组件通过 context 读到同一份状态，切页只是换渲染，不会丢未落盘的输入。
 */
export function useSettingsDraft({
	locale,
	t,
	onLocaleChange,
	onWebdavConnected,
	onFavoritesPurged,
}: UseSettingsDraftOptions) {
	const [supjav, setSupjav] = useState("");
	const [javbus, setJavbus] = useState("");
	const [supjavName, setSupjavName] = useState(DEFAULT_SETTINGS.supjavName);
	const [javdbName, setJavdbName] = useState(DEFAULT_SETTINGS.javdbName);
	// 自定义平台：无默认配置，空 = 面板不显示按钮
	const [customName, setCustomName] = useState("");
	const [customTemplate, setCustomTemplate] = useState("");
	const [translateApiKey, setTranslateApiKey] = useState("");
	// 自建翻译服务（OpenAI 兼容）：地址、模型与开关（默认关闭 = 纯备用服务模式）
	const [translateUrl, setTranslateUrl] = useState("");
	const [translateModel, setTranslateModel] = useState("");
	const [translateEnabled, setTranslateEnabled] = useState(false);
	// 备用翻译服务：自建服务未配置或调用失败时的兜底（默认谷歌）
	const [fallbackService, setFallbackService] =
		useState<FallbackService>("google");
	// /v1/models 拉到的模型列表（下拉框用）；空 = 拉取失败，退回手填
	const [translateModels, setTranslateModels] = useState<string[]>([]);
	const [translateModelsLoading, setTranslateModelsLoading] = useState(false);
	const [translateModelsError, setTranslateModelsError] = useState<string | null>(
		null,
	);
	// 开关打开时的验证错误行（可关闭）
	const [translateVerifyError, setTranslateVerifyError] = useState<
		string | null
	>(null);
	const [webdavUrl, setWebdavUrl] = useState("");
	const [webdavUser, setWebdavUser] = useState("");
	const [webdavPass, setWebdavPass] = useState("");
	// 云盘同步开关（打开才存取云端，打开时验证）
	const [webdavEnabled, setWebdavEnabled] = useState(false);
	const [webdavError, setWebdavError] = useState<string | null>(null);
	// 云端已有配置且本地已自定义：等用户选“从云端恢复 / 用本地覆盖”，不静默覆盖任何一侧
	const [cloudConflict, setCloudConflict] = useState<CloudSettings | null>(null);
	// 云盘同步结果：就地显示在云盘区块
	const [cloudStatus, setCloudStatus] = useState<{
		ok: boolean;
		text: string;
	} | null>(null);
	// 番号查询（自建反代）：一个地址一把 Key，DMM / FALENO / 无码源三条路径由地址派生
	const [apiUrl, setApiUrl] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [lookupEnabled, setLookupEnabled] = useState(false);
	const [lookupVerifyError, setLookupVerifyError] = useState<string | null>(null);
	// 三个服务开关共用的「校验中」标记：期间开关禁用、状态文案显示「连接中」，
	// 避免用户在校验未回时反复点击
	const [lookupVerifying, setLookupVerifying] = useState(false);
	const [embyVerifying, setEmbyVerifying] = useState(false);
	const [translateVerifying, setTranslateVerifying] = useState(false);
	// Emby 媒体库配置
	const [embyUrl, setEmbyUrl] = useState("");
	const [embyApiKey, setEmbyApiKey] = useState("");
	const [embyEnabled, setEmbyEnabled] = useState(false);
	const [embyVerifyError, setEmbyVerifyError] = useState<string | null>(null);
	const [embyIndexInfo, setEmbyIndexInfo] = useState<{
		syncedAt: number | null;
		total: number;
	}>({ syncedAt: null, total: 0 });
	// 库条目超过上限：background 走逐个番号查询且不落盘索引
	const [embyTooLarge, setEmbyTooLarge] = useState(false);
	// 删除收藏：打开即真实删除「已在 Emby 库中」的收藏（不可恢复）
	const [embyDropFavorites, setEmbyDropFavorites] = useState(
		DEFAULT_SETTINGS.embyDropFavoritesInLibrary,
	);
	// 待确认的删除条数：> 0 时在开关下方展示确认区，null = 无待确认动作。
	// 开关此期间保持关闭 —— 只有点「删除并开启」才真正落盘并打开
	const [dropFavoritesConfirm, setDropFavoritesConfirm] = useState<number | null>(
		null,
	);
	// 该区域的一次性提示（未启用 / 缺配置 / 缺索引 / 已删除 N 条）
	const [dropFavoritesNotice, setDropFavoritesNotice] = useState<string | null>(
		null,
	);
	// 打开开关前强制同步索引：期间开关禁用，避免重复触发并发同步
	const [dropFavoritesSyncing, setDropFavoritesSyncing] = useState(false);
	const [localeOption, setLocaleOption] = useState<LocaleOption>("auto");
	// 界面外观主题：默认跟随系统；选择即即时落盘，无需「保存设置」按钮
	const [themeOption, setThemeOption] = useState<ThemeOption>("system");
	const [excludedHosts, setExcludedHosts] = useState<string[]>([]);
	const [newHostInput, setNewHostInput] = useState("");
	const [falenoPrefixes, setFalenoPrefixes] = useState<string[]>([]);
	const [newPrefixInput, setNewPrefixInput] = useState("");
	const [customRegex, setCustomRegex] = useState("");
	const [regexError, setRegexError] = useState<string | null>(null);
	// 番号排除正则（全局黑名单）：扫描候选命中即剔除（有码/无码两侧都生效），不改变形态判定
	const [codeExcludeRegex, setCodeExcludeRegex] = useState("");
	const [codeExcludeRegexError, setCodeExcludeRegexError] = useState<string | null>(
		null,
	);
	const [previewVolume, setPreviewVolume] = useState(
		DEFAULT_SETTINGS.previewVolume,
	);
	// 自动保存的瞬时反馈：saved = 刚写盘（1.2s 后自动隐藏）
	const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

	// 拉取可用模型列表（/v1/models），用于设置页下拉框；
	// 凭据缺失直接清空列表；同一 url|key 签名不变则不重复拉取（手动「获取模型」可 force）。
	// AI 模式无字符配额，故只有模型列表、没有用量轮询。
	const modelsSig = useRef<string | null>(null);
	const fetchTranslateModels = async (
		urlOverride?: string,
		keyOverride?: string,
		options: { force?: boolean; autoSelect?: boolean } = {},
	) => {
		const url = (urlOverride ?? latest.current.translateApiUrl).trim();
		const key = (keyOverride ?? latest.current.translateApiKey).trim();
		if (!url || !key) {
			modelsSig.current = null;
			setTranslateModels([]);
			setTranslateModelsError(null);
			return;
		}
		const sig = `${url}|${key}`;
		if (!options.force && modelsSig.current === sig) return; // 未变化不重复拉
		modelsSig.current = sig;
		setTranslateModelsLoading(true);
		setTranslateModelsError(null); // 清掉上次失败，避免下拉面板一直显示旧错误
		try {
			const res = (await browser.runtime.sendMessage({
				type: "jt:models",
				translateApiKey: key,
				translateUrl: url,
			})) as { models?: string[]; error?: string } | undefined;
			if (modelsSig.current !== sig) return; // 丢弃过期响应
			const models = Array.isArray(res?.models) ? res.models : [];
			const error = res?.error
				? res.error === "network"
					? t.networkError
					: res.error === "incomplete"
						? t.translateApiIncomplete
						: res.error
				: null;
			setTranslateModels(models);
			setTranslateModelsError(error);
			// 手动「获取模型」成功时：输入框已有值就保留（只刷新列表），
			// 为空才自动填第一个；自动拉取永远不覆盖用户手填值。
			// 用函数式更新读当前值，避免 latest 快照落后一帧。
			if (options.autoSelect && !error && models.length > 0) {
				setTranslateModel((current) =>
					current.trim() ? current : models[0]!,
				);
			}
		} catch {
			if (modelsSig.current !== sig) return;
			setTranslateModels([]);
			setTranslateModelsError(t.networkError);
		} finally {
			if (modelsSig.current === sig) setTranslateModelsLoading(false);
		}
	};

	/**
	 * 「获取模型」按钮：忽略签名缓存强制重拉；输入框为空时自动填第一个模型，
	 * 已有手填值则只刷新列表、不覆盖。失败信息落在下拉面板里
	 * （不写进 translateModel，避免错误文本被存成模型名）。
	 */
	const refreshTranslateModels = () =>
		fetchTranslateModels(undefined, undefined, {
			force: true,
			autoSelect: true,
		});

	// 启用开关：打开时先验证接口 /v1/models，成功再拉模型列表；
	// 验证失败回弹关闭并显示可关闭的错误信息行
	const handleToggleTranslate = async (checked: boolean) => {
		setTranslateVerifyError(null);
		if (!checked) {
			setTranslateEnabled(false);
			// 即时清空模型列表与状态，避免旧数据残留
			modelsSig.current = null;
			setTranslateModels([]);
			setTranslateModelsError(null);
			return;
		}
		const url = translateUrl.trim();
		const key = translateApiKey.trim();
		if (!url || !key) {
			setTranslateVerifyError(t.translateApiIncomplete);
			setTranslateEnabled(false);
			return;
		}
		setTranslateVerifying(true);
		try {
			const health = (await browser.runtime.sendMessage({
				type: "jt:health",
				translateApiKey: key,
				translateUrl: url,
				locale,
			})) as { ok?: boolean; error?: string } | undefined;
			if (!health?.ok) {
				setTranslateVerifyError(
					`${t.verifyFailed}：${health?.error || t.unknownError}`,
				);
				setTranslateEnabled(false);
				return;
			}
			setTranslateEnabled(true);
			// 健康已通过，顺带拉取模型列表（显式参数，跳过 latest 旧帧）
			void fetchTranslateModels(url, key);
		} catch {
			setTranslateVerifyError(`${t.verifyFailed}：${t.networkError}`);
			setTranslateEnabled(false);
		} finally {
			setTranslateVerifying(false);
		}
	};

	/**
	 * 调反代 /health：一次请求同时验证「服务活着」与「Key 正确」。
	 * @returns 通过返回 null；失败返回可直接展示的错误文案
	 */
	const verifyLookupService = async (
		url: string,
		key: string,
	): Promise<string | null> => {
		try {
			const res = (await browser.runtime.sendMessage({
				type: "jt:lookup-health",
				apiUrl: url,
				apiKey: key,
			})) as { ok?: boolean; reason?: string } | undefined;
			if (res?.ok) return null;
			if (res?.reason === "unauthorized") return t.lookupUnauthorized;
			if (res?.reason === "config") return t.lookupConfigError;
			if (res?.reason === "incomplete") return t.lookupIncomplete;
			return `${t.verifyFailed}：${t.networkError}`;
		} catch {
			return `${t.verifyFailed}：${t.networkError}`;
		}
	};

	// 番号查询开关：打开时先清空错误行，地址/Key 不全则就地提示；
	// 齐备则调 /health，校验期间开关禁用并显示「连接中」，通过才真正打开
	const handleToggleLookup = async (checked: boolean) => {
		setLookupVerifyError(null);
		if (!checked) {
			setLookupEnabled(false);
			return;
		}
		const url = apiUrl.trim();
		const key = apiKey.trim();
		if (!url || !key) {
			setLookupVerifyError(t.lookupIncomplete);
			setLookupEnabled(false);
			return;
		}
		setLookupVerifying(true);
		try {
			const error = await verifyLookupService(url, key);
			if (error) {
				setLookupVerifyError(error);
				setLookupEnabled(false);
				return;
			}
			setLookupEnabled(true);
		} finally {
			setLookupVerifying(false);
		}
	};

	// 排除正则的即时语法校验（与番号识别正则同款）
	const handleCodeExcludeRegexChange = (val: string) => {
		setCodeExcludeRegex(val);
		if (val.trim() && !isValidRegex(val)) {
			setCodeExcludeRegexError(t.regexSyntaxError);
		} else {
			setCodeExcludeRegexError(null);
		}
	};

	/**
	 * 强制走一次 background 同步，只返回结果、不碰任何 UI 状态。
	 * 抽出来是因为两个调用方要各自决定怎么提示：「立即同步」写在 Emby 行的
	 * 错误位上，删除收藏开关写在它自己的提示位，混在一起会互相覆盖。
	 */
	const syncEmbyIndex = async (): Promise<
		| { ok: true; syncedAt: number; total: number }
		| { ok: false; kind: "too-large" }
		| { ok: false; kind: "failed" | "network"; message: string }
	> => {
		try {
			const res = (await browser.runtime.sendMessage({
				type: "jt:emby-sync",
				embyUrl: embyUrl.trim(),
				embyApiKey: embyApiKey.trim(),
				regex: customRegex || DEFAULT_CODE_REGEX,
			})) as
				| {
						ok?: boolean;
						mode?: string;
						syncedAt?: number;
						total?: number;
						error?: string;
				  }
				| undefined;
			if (!res?.ok) {
				return {
					ok: false,
					kind: "failed",
					message: res?.error || t.unknownError,
				};
			}
			// 超额降级：background 不落盘索引（只有逐个番号查询），
			// 调用方据此提示改用逐个查询，且不要伪造一次「刚同步」的状态
			if (res.mode === "too-large") return { ok: false, kind: "too-large" };
			return {
				ok: true,
				syncedAt: res.syncedAt ?? Date.now(),
				total: res.total ?? 0,
			};
		} catch {
			return { ok: false, kind: "network", message: t.networkError };
		}
	};

	// 立即同步：强制同步一次并刷新索引信息
	const handleEmbySyncNow = async () => {
		setEmbyVerifyError(null);
		const res = await syncEmbyIndex();
		if (!res.ok) {
			// 保留原有 syncedAt/total：一次降级同步不该被显示成「刚同步过」
			if (res.kind === "too-large") {
				setEmbyTooLarge(true);
				return;
			}
			setEmbyVerifyError(`${t.embySyncFailed}：${res.message}`);
			return;
		}
		setEmbyTooLarge(false);
		setEmbyIndexInfo({ syncedAt: res.syncedAt, total: res.total });
		// 同步意味着库里可能有新增条目：开关开着就顺手把「先收藏、后入库」的收藏清掉
		await purgeLibraryFavorites();
	};

	// Emby 开关：打开时先验证地址与 Key（拉 1 条确认权限），失败回弹关闭。
	// 验证成功后顺手预取媒体库索引（background 落盘），回到识别页即可显示在库标识。
	const handleToggleEmby = async (checked: boolean) => {
		setEmbyVerifyError(null);
		if (!checked) {
			setEmbyEnabled(false);
			return;
		}
		const url = embyUrl.trim();
		const key = embyApiKey.trim();
		if (!url || !key) {
			setEmbyVerifyError(t.embyIncomplete);
			setEmbyEnabled(false);
			return;
		}
		setEmbyVerifying(true);
		try {
			const health = (await browser.runtime.sendMessage({
				type: "jt:emby-test",
				embyUrl: url,
				embyApiKey: key,
			})) as { ok?: boolean; error?: string } | undefined;
			if (!health?.ok) {
				setEmbyVerifyError(
					`${t.verifyFailed}：${health?.error || t.unknownError}`,
				);
				setEmbyEnabled(false);
				return;
			}
			setEmbyEnabled(true);
			await handleEmbySyncNow();
		} catch {
			setEmbyVerifyError(`${t.verifyFailed}：${t.networkError}`);
			setEmbyEnabled(false);
		} finally {
			setEmbyVerifying(false);
		}
	};

	/**
	 * 云端收藏整体覆盖：只有「已配置且已启用」云同步时才发请求。
	 * 失败静默 + console.warn —— 与 App.tsx 的 pushToCloud 同口径：
	 * 一次上传失败不该把已经完成的本地清理变成半途状态，下次收藏操作会再整体覆盖。
	 */
	const purgeCloudFavorites = async (kept: string[]): Promise<void> => {
		const url = webdavUrl.trim();
		const user = webdavUser.trim();
		if (!webdavEnabled || !url || !user) return;
		try {
			await browser.runtime.sendMessage({
				type: "jt:webdav-put",
				webdavUrl: url,
				webdavUser: user,
				webdavPass,
				body: serializeFavorites(kept),
			});
		} catch (error) {
			console.warn("[JavCode Finder] 云端收藏清理失败:", error);
		}
	};

	/**
	 * 索引更新后按「删除收藏」规则再对齐一次收藏。
	 * 打开开关那一刀只处理当时已在库的番号；「先收藏、之后才入库」的番号是之后
	 * 才进 Emby 的，只能在索引更新后重新比对才抓得到。规则持续生效，故静默执行。
	 * 三道前提与删除动作一致：开关开着、Emby 启用且配置齐全、索引指纹对得上。
	 */
	const purgeLibraryFavorites = async (): Promise<void> => {
		if (!embyDropFavorites) return;
		const url = embyUrl.trim();
		const key = embyApiKey.trim();
		if (!embyEnabled || !url || !key) return;
		const index = await loadEmbyIndex(browserEmbyStore());
		if (!index || index.keys.length === 0) return;
		if (index.serverKey !== embyServerKey(url, key)) return;
		const current = loadFavorites(getStorage());
		const { kept } = splitFavoritesByLibrary(current, index.keys);
		const removedCount = current.length - kept.length;
		if (removedCount === 0) return;
		saveFavorites(getStorage(), kept);
		// 主面板与云端都要跟着走：否则列表还留着已删的项，换设备又会被拉回来
		onFavoritesPurged?.(kept);
		void purgeCloudFavorites(kept);
		setDropFavoritesNotice(t.embyDropFavoritesDone(removedCount));
	};

	/**
	 * 读索引并算出「在库收藏」。
	 * 四种情况一律当作「没有索引」，但各自返回原因 —— 提示文案要分流：
	 * 未启用说「请先启用 Emby」，而不是笼统地让人去同步。
	 * 1. Emby 总开关关闭 —— 关开关不会清索引，残留索引不能成为删除依据；
	 * 2. Emby 未配置（无地址/Key）—— 此时不存在「在库」这个概念；
	 * 3. 索引缺失或 keys 为空 —— 空键集既算不出 N，也可能来自未同步 / 同步失败，
	 *    若放行会让空集合去匹配整份收藏（不可恢复）；
	 * 4. 索引的服务器指纹与当前配置不符 —— 换地址/换 Key 后旧索引的键与新库无关。
	 * 前面有这道闸，后面任何删除动作都不可能作用在无效索引上。
	 */
	const collectLibraryFavorites = async (): Promise<
		| { ok: true; kept: string[]; removedCount: number }
		| { ok: false; reason: "disabled" | "incomplete" | "noindex" | "stale" }
	> => {
		const url = embyUrl.trim();
		const key = embyApiKey.trim();
		if (!embyEnabled) return { ok: false, reason: "disabled" };
		if (!url || !key) return { ok: false, reason: "incomplete" };
		const index = await loadEmbyIndex(browserEmbyStore());
		if (!index || index.keys.length === 0) {
			return { ok: false, reason: "noindex" };
		}
		if (index.serverKey !== embyServerKey(url, key)) {
			return { ok: false, reason: "stale" };
		}
		const current = loadFavorites(getStorage());
		const { kept } = splitFavoritesByLibrary(current, index.keys);
		// 计数用「原始条数 − 保留条数」：removed 是归一化去重后的集合，
		// 收藏里同时有 ABC-123 与 abc-123 时会少报，而实际删掉的是两条
		return { ok: true, kept, removedCount: current.length - kept.length };
	};

	/** 按拦截原因选提示文案：未启用 / 缺地址 Key / 缺索引或索引过期 */
	const dropFavoritesBlockedNotice = (
		reason: "disabled" | "incomplete" | "noindex" | "stale",
	): string =>
		reason === "disabled"
			? t.embyDropFavoritesNeedEnable
			: reason === "incomplete"
				? t.embyIncomplete
				: t.embyDropFavoritesNeedIndex;

	// 删除收藏开关：这是真删数据，所以先强制同步最新索引、再算量，
	// 最后决定「直接开」还是「先确认」
	const handleToggleEmbyDropFavorites = async (checked: boolean) => {
		setDropFavoritesNotice(null);
		setDropFavoritesConfirm(null);
		if (!checked) {
			setEmbyDropFavorites(false);
			return;
		}
		if (!embyEnabled) {
			setDropFavoritesNotice(t.embyDropFavoritesNeedEnable);
			setEmbyDropFavorites(false);
			return;
		}
		if (!embyUrl.trim() || !embyApiKey.trim()) {
			setDropFavoritesNotice(t.embyIncomplete);
			setEmbyDropFavorites(false);
			return;
		}
		// 强制同步一次：索引只是上次同步的快照，库里刚删过的片子仍会留在旧索引里，
		// 拿它算「在库」会把用户的收藏误删。这一步保证 N 算在最新库状态上。
		setDropFavoritesSyncing(true);
		try {
			const sync = await syncEmbyIndex();
			if (!sync.ok) {
				// 同步失败就不该继续算量：宁可让用户点「立即同步」重试，也不拿旧数据删收藏
				if (sync.kind === "too-large") {
					setEmbyTooLarge(true);
					setDropFavoritesNotice(t.embyTooLarge);
				} else {
					setDropFavoritesNotice(`${t.embySyncFailed}：${sync.message}`);
				}
				setEmbyDropFavorites(false);
				return;
			}
			setEmbyTooLarge(false);
			setEmbyIndexInfo({ syncedAt: sync.syncedAt, total: sync.total });

			const result = await collectLibraryFavorites();
			if (!result.ok) {
				// 同步成功却仍拿不到索引：就地提示原因，而不是静默什么都删不到
				setDropFavoritesNotice(dropFavoritesBlockedNotice(result.reason));
				setEmbyDropFavorites(false);
				return;
			}
			if (result.removedCount === 0) {
				// 没有可删项：直接打开，不打扰用户
				setEmbyDropFavorites(true);
				return;
			}
			// 有东西要删：开关保持关闭，先让用户看清条数与「不可恢复」的后果
			setDropFavoritesConfirm(result.removedCount);
		} finally {
			setDropFavoritesSyncing(false);
		}
	};

	// 确认删除：重新读一次索引（确认期间可能又同步过库），删本地并整体覆盖云端
	const handleConfirmDropFavorites = async () => {
		const result = await collectLibraryFavorites();
		setDropFavoritesConfirm(null);
		if (!result.ok) {
			setDropFavoritesNotice(dropFavoritesBlockedNotice(result.reason));
			setEmbyDropFavorites(false);
			return;
		}
		if (result.removedCount === 0) {
			// 二次计算已无可删项（索引变化 / 已清理）：直接打开，不写盘
			setEmbyDropFavorites(true);
			return;
		}
		saveFavorites(getStorage(), result.kept);
		// 主面板收藏状态靠回调同步：同页面写 localStorage 不触发 storage 事件
		onFavoritesPurged?.(result.kept);
		void purgeCloudFavorites(result.kept);
		setEmbyDropFavorites(true);
		setDropFavoritesNotice(t.embyDropFavoritesDone(result.removedCount));
	};

	// 取消：开关保持关闭，清空待确认
	const handleCancelDropFavorites = () => {
		setDropFavoritesConfirm(null);
		setDropFavoritesNotice(null);
		setEmbyDropFavorites(false);
	};

	// 把一份完整配置灌进表单：挂载时与“从云端恢复”后共用同一套字段映射，
	// 避免新增配置项时两处漏改导致恢复后表单与已落盘配置不一致
	const hydrateForm = (current: ExtensionSettings, localeOpt: LocaleOption) => {
		setSupjav(current.supjavTemplate);
		setJavbus(current.javbusTemplate);
		setSupjavName(current.supjavName);
		setJavdbName(current.javdbName);
		setCustomName(current.customName);
		setCustomTemplate(current.customTemplate);
		setTranslateApiKey(current.translateApiKey);
		setTranslateModel(current.translateModel);
		setTranslateUrl(current.translateApiUrl);
		setTranslateEnabled(current.translateEnabled);
		setFallbackService(current.fallbackService);
		setWebdavUrl(current.webdavUrl);
		setWebdavUser(current.webdavUser);
		setWebdavPass(current.webdavPass);
		setWebdavEnabled(current.webdavEnabled);
		setApiUrl(current.apiUrl);
		setApiKey(current.apiKey);
		setLookupEnabled(current.lookupEnabled);
		setEmbyUrl(current.embyUrl);
		setEmbyApiKey(current.embyApiKey);
		setEmbyEnabled(current.embyEnabled);
		setEmbyDropFavorites(current.embyDropFavoritesInLibrary);
		// 待确认动作是会话内的临时状态：重新灌值后旧确认区必须失效
		setDropFavoritesConfirm(null);
		setDropFavoritesNotice(null);
		setLocaleOption(localeOpt);
		setThemeOption(current.theme);
		setExcludedHosts(current.excludedHosts || DEFAULT_SETTINGS.excludedHosts);
		setFalenoPrefixes(current.falenoPrefixes);
		setCustomRegex(current.customRegex || DEFAULT_CODE_REGEX);
		setCodeExcludeRegex(current.codeExcludeRegex);
		setRegexError(null);
		setCodeExcludeRegexError(null);
		setPreviewVolume(current.previewVolume);
	};

	// 表单当前值 → 完整配置对象：本地落盘与云端备份共用同一份口径
	const collectFormSettings = (): ExtensionSettings => ({
		supjavName,
		supjavTemplate: supjav,
		javdbName,
		javbusTemplate: javbus,
		customName,
		customTemplate,
		previewVolume,
		translateApiKey,
		translateModel,
		translateApiUrl: translateUrl,
		translateEnabled,
		fallbackService,
		apiUrl,
		apiKey,
		lookupEnabled,
		embyUrl,
		embyApiKey,
		embyEnabled,
		embyDropFavoritesInLibrary: embyDropFavorites,
		webdavUrl,
		webdavUser,
		webdavPass,
		webdavEnabled,
		excludedHosts,
		falenoPrefixes,
		customRegex: customRegex.trim() || DEFAULT_CODE_REGEX,
		codeExcludeRegex,
		theme: themeOption,
	});

	// 推送当前配置到云端（整体覆盖）。返回结果而不是布尔值：
	// 失败必须带上 HTTP 状态，否则“云盘里没有文件”这类问题无从定位
	const pushCloudSettings = async (): Promise<{
		ok: boolean;
		status: number;
	}> => {
		const url = webdavUrl.trim();
		const user = webdavUser.trim();
		if (!url || !user) return { ok: false, status: 0 };
		try {
			const res = (await browser.runtime.sendMessage({
				type: "jt:webdav-settings-put",
				webdavUrl: url,
				webdavUser: user,
				webdavPass,
				body: serializeCloudSettings(collectFormSettings(), localeOption),
			})) as { ok?: boolean; status?: number } | undefined;
			const ok = Boolean(res?.ok);
			if (!ok) {
				console.warn(
					"[JavCode Finder] 云端配置写入失败:",
					res?.status ?? "no-response",
				);
			}
			return { ok, status: typeof res?.status === "number" ? res.status : 0 };
		} catch (error) {
			console.warn("[JavCode Finder] 云端配置写入异常:", error);
			return { ok: false, status: 0 };
		}
	};

	type CloudFetch =
		| { status: "found"; cloud: CloudSettings }
		| { status: "empty" }
		| { status: "error"; httpStatus: number };

	// 拉取云端配置：404 = 云端无配置；网络/解析失败单独一档，
	// 与“无配置”分开 —— 否则一次瞬时失败就会被当成空云端，用本地把备份覆盖掉
	const fetchCloudSettings = async (): Promise<CloudFetch> => {
		const url = webdavUrl.trim();
		const user = webdavUser.trim();
		if (!url || !user) return { status: "empty" };
		try {
			const res = (await browser.runtime.sendMessage({
				type: "jt:webdav-settings-get",
				webdavUrl: url,
				webdavUser: user,
				webdavPass,
			})) as { found?: boolean; data?: unknown; error?: string } | undefined;
			if (!res) return { status: "error", httpStatus: 0 };
			// found=false 且带 error = 非 404 的失败（鉴权过期、5xx、网络中断）：
			// 不能当成“云端无配置”，否则下一步会用本地把云端备份覆盖掉
			if (!res.found) {
				return res.error
					? { status: "error", httpStatus: httpStatusOf(res.error) }
					: { status: "empty" };
			}
			const cloud = parseCloudSettings(res.data);
			return cloud
				? { status: "found", cloud }
				: { status: "error", httpStatus: 0 };
		} catch (error) {
			console.warn("[JavCode Finder] 云端配置读取异常:", error);
			return { status: "error", httpStatus: 0 };
		}
	};

	// 把云端配置落到本地并回灌表单：云盘连接参数沿用表单里刚验证通过的值
	const applyCloudSettings = (cloud: CloudSettings) => {
		const merged = mergeCloudSettings(cloud, {
			url: webdavUrl.trim(),
			user: webdavUser.trim(),
			pass: webdavPass,
		});
		const saved = saveSettings(merged);
		saveLocale(cloud.locale);
		onLocaleChange?.(getEffectiveLocale(cloud.locale));
		hydrateForm(saved, cloud.locale);
		setCloudConflict(null);
		setCloudStatus({ ok: true, text: t.cloudSettingsRestored });
		setSaveState("saved");
		// 仅启用时才查用量；显式参数避免读到灌值前的旧帧
		if (saved.translateEnabled) {
			void fetchTranslateModels(saved.translateApiUrl, saved.translateApiKey);
		}
	};

	// 打开开关后的一次性对齐：云端无配置 → 推本地做首次备份；
	// 本地仍是出厂状态 → 直接恢复（重装/换设备）；两边都有自定义 → 交给用户选。
	const syncCloudOnConnect = async () => {
		const res = await fetchCloudSettings();
		if (res.status === "error") {
			setCloudStatus({
				ok: false,
				text: t.cloudReadFailed(res.httpStatus),
			});
			return;
		}
		const cloud = res.status === "found" ? res.cloud : null;
		const action = decideCloudSettingsAction(cloud, collectFormSettings());
		if (action === "pull" && cloud) {
			applyCloudSettings(cloud);
			return;
		}
		if (action === "conflict" && cloud) {
			setCloudConflict(cloud);
			return;
		}
		const pushed = await pushCloudSettings();
		if (pushed.ok) {
			setCloudStatus({ ok: true, text: t.cloudSettingsSynced });
		} else {
			setCloudStatus({
				ok: false,
				text: t.cloudPushFailed(pushed.status),
			});
		}
	};

	// 冲突时选择“用本地覆盖云端”：只上传，不动本地配置
	const handleOverwriteCloud = async () => {
		setCloudConflict(null);
		const pushed = await pushCloudSettings();
		if (pushed.ok) {
			setCloudStatus({ ok: true, text: t.cloudSettingsSynced });
		} else {
			setCloudStatus({
				ok: false,
				text: t.cloudPushFailed(pushed.status),
			});
		}
	};

	// 云盘验证：PROPFIND Depth:0，结果分类交给 classifyWebdavVerify
	const verifyWebdav = async (
		url: string,
		user: string,
		pass: string,
	): Promise<WebdavVerifyResult> => {
		try {
			const res = (await browser.runtime.sendMessage({
				type: "jt:webdav-verify",
				webdavUrl: url,
				webdavUser: user,
				webdavPass: pass,
			})) as { status?: number } | undefined;
			return classifyWebdavVerify(res?.status ?? 0);
		} catch {
			return "failed";
		}
	};

	// 云端验证错误分类 → 界面文案
	const webdavErrorText: Record<WebdavVerifyResult, string> = {
		ok: t.webdavConnected,
		auth: t.webdavAuthError,
		not_found: t.webdavNotFound,
		rate_limited: t.webdavRateLimited,
		failed: t.webdavConnectError,
	};

	// 云盘同步开关：打开时验证连接，成功开通（触发首次同步）；失败回弹并显示错误
	const handleToggleWebdav = async (checked: boolean) => {
		setWebdavError(null);
		setCloudConflict(null);
		setCloudStatus(null);
		if (!checked) {
			setWebdavEnabled(false);
			return;
		}
		const urlTrimmed = webdavUrl.trim();
		const userTrimmed = webdavUser.trim();
		if (!urlTrimmed || !userTrimmed) {
			setWebdavError(t.webdavIncomplete);
			setWebdavEnabled(false);
			return;
		}
		const result = await verifyWebdav(urlTrimmed, userTrimmed, webdavPass);
		if (result === "ok") {
			setWebdavEnabled(true);
			// 连接可用后再对齐配置：验证失败时不动云端，避免半途状态。
			await syncCloudOnConnect();
			onWebdavConnected?.();
		} else {
			setWebdavError(webdavErrorText[result]);
			setWebdavEnabled(false);
		}
	};

	const handleLocaleSelect = (val: LocaleOption) => {
		setLocaleOption(val);
		saveLocale(val);
		onLocaleChange?.(getEffectiveLocale(val));
	};

	// 界面外观：选择即即时落盘（与语言一致，无需「保存设置」按钮）
	const handleThemeSelect = (val: ThemeOption) => {
		setThemeOption(val);
		saveSettings({ theme: val });
	};

	const handleAddHost = () => {
		const norm = normalizeDomain(newHostInput);
		if (!norm) return;
		if (!excludedHosts.includes(norm)) {
			setExcludedHosts([...excludedHosts, norm]);
		}
		setNewHostInput("");
	};

	const handleRemoveHost = (hostToRemove: string) => {
		setExcludedHosts(excludedHosts.filter((h) => h !== hostToRemove));
	};

	const handleAddPrefix = () => {
		const norm = normalizePrefix(newPrefixInput);
		if (!norm) return;
		if (!falenoPrefixes.includes(norm)) {
			setFalenoPrefixes([...falenoPrefixes, norm]);
		}
		setNewPrefixInput("");
	};

	const handleRemovePrefix = (prefixToRemove: string) => {
		setFalenoPrefixes(falenoPrefixes.filter((p) => p !== prefixToRemove));
	};

	const handleRegexChange = (val: string) => {
		setCustomRegex(val);
		if (val.trim() && !isValidRegex(val)) {
			setRegexError(t.regexSyntaxError);
		} else {
			setRegexError(null);
		}
	};

	const handleResetRegex = () => {
		setCustomRegex(DEFAULT_CODE_REGEX);
		setRegexError(null);
	};

	// 恢复默认：立即落盘（没有保存按钮，撤销只能靠用户重新填写）
	const handleReset = () => {
		resetSettings();
		setSupjav("");
		setJavbus(DEFAULT_SETTINGS.javbusTemplate);
		setSupjavName(DEFAULT_SETTINGS.supjavName);
		setJavdbName(DEFAULT_SETTINGS.javdbName);
		setCustomName("");
		setCustomTemplate("");
		setTranslateApiKey("");
		setTranslateModel("");
		setTranslateUrl("");
		setTranslateEnabled(false);
		modelsSig.current = null;
		setTranslateModels([]);
		setTranslateModelsError(null);
		setTranslateVerifyError(null);
		setWebdavUrl("");
		setWebdavUser("");
		setWebdavPass("");
		setWebdavEnabled(false);
		setWebdavError(null);
		setApiUrl(DEFAULT_SETTINGS.apiUrl);
		setApiKey(DEFAULT_SETTINGS.apiKey);
		setLookupEnabled(DEFAULT_SETTINGS.lookupEnabled);
		setLookupVerifyError(null);
		setEmbyUrl(DEFAULT_SETTINGS.embyUrl);
		setEmbyApiKey(DEFAULT_SETTINGS.embyApiKey);
		setEmbyEnabled(DEFAULT_SETTINGS.embyEnabled);
		setEmbyVerifyError(null);
		setEmbyDropFavorites(DEFAULT_SETTINGS.embyDropFavoritesInLibrary);
		setDropFavoritesConfirm(null);
		setDropFavoritesNotice(null);
		setEmbyIndexInfo({ syncedAt: null, total: 0 });
		setEmbyTooLarge(false);
		setExcludedHosts([...DEFAULT_SETTINGS.excludedHosts]);
		setFalenoPrefixes([...DEFAULT_SETTINGS.falenoPrefixes]);
		setNewPrefixInput("");
		setCustomRegex(DEFAULT_CODE_REGEX);
		setRegexError(null);
		setCodeExcludeRegex(DEFAULT_SETTINGS.codeExcludeRegex);
		setCodeExcludeRegexError(null);
		setPreviewVolume(DEFAULT_SETTINGS.previewVolume);
		setNewHostInput("");
		saveLocale("auto");
		setLocaleOption("auto");
		setThemeOption("system");
		onLocaleChange?.(getEffectiveLocale("auto"));
		setCloudConflict(null);
		setCloudStatus(null);
	};

	// 应用主题到文档根：data-theme=light 时切浅色变量套；跟随系统时按系统明暗并监听变化
	useEffect(() => {
		const root = document.documentElement;
		const mql = window.matchMedia("(prefers-color-scheme: dark)");
		const applyTheme = () => {
			const actual: "light" | "dark" =
				themeOption === "system"
					? mql.matches
						? "dark"
						: "light"
					: themeOption;
			root.setAttribute("data-theme", actual);
		};
		applyTheme();
		if (themeOption === "system") {
			mql.addEventListener("change", applyTheme);
			return () => mql.removeEventListener("change", applyTheme);
		}
	}, [themeOption]);

	// 每次渲染算一次签名：只有签名变化才触发落盘，避免开关验证等异步 setState 反复写盘
	const formConfig: ExtensionSettings = collectFormSettings();
	const signature = configSignature(formConfig);

	// 最新一帧的表单值快照：防抖回调里读它，不对着闭包里的旧值写盘
	const latest = useRef(formConfig);
	latest.current = formConfig;
	const latestLocale = useRef<LocaleOption>(localeOption);
	latestLocale.current = localeOption;

	// 上次落盘时的签名：用来区分“真的改了”与“只重渲染了一次”
	const savedSignature = useRef<string | null>(null);
	// 上次拉取用量的翻译配置签名：没换地址/Key 就不重复请求
	const modelsSignature = useRef<string | null>(null);

	// 挂载：灌入已保存配置 -> 才允许自动保存接管，否则首帧空表单会把配置写成空值。
	// 用 state 而不是 ref：ready 变化要触发自动保存 effect 重新评估一次签名
	const [ready, setReady] = useState(false);
	const readyRef = useRef(false);
	useEffect(() => {
		const current = getSettings();
		hydrateForm(current, getSavedLocale());
		let cancelled = false;
		void (async () => {
			const index = await loadEmbyIndex(browserEmbyStore());
			if (cancelled) return;
			setEmbyIndexInfo({
				syncedAt: index?.syncedAt ?? null,
				total: index?.total ?? 0,
			});
		})();
		// 挂载时若已启用则拉取模型列表；显式参数避免读到灌值前的旧帧
		if (current.translateEnabled) {
			void fetchTranslateModels(current.translateApiUrl, current.translateApiKey);
		}
		// 首帧把签名记下来：hydrate 已经写盘一次，不该再触发一次保存
		savedSignature.current = configSignature(current);
		readyRef.current = true;
		setReady(true);
		return () => {
			cancelled = true;
		};
	}, []);

	// 卸载兜底：设置页关闭时防抖可能还没到点，最后一段输入在这里立即落盘。
	// 只在真正卸载时运行（deps 为空），不影响正常的防抖保存。
	useEffect(
		() => () => {
			if (!readyRef.current) return;
			const conf = latest.current;
			const broken =
				(conf.customRegex && !isValidRegex(conf.customRegex)) ||
				(conf.codeExcludeRegex &&
					!isValidRegex(conf.codeExcludeRegex));
			if (broken) return;
			if (savedSignature.current === configSignature(conf)) return;
			saveSettings(conf);
			if (getSavedLocale() !== latestLocale.current) {
				saveLocale(latestLocale.current);
			}
			// 云盘开着就顺手推一次；sidepanel 关闭后 background 仍会完成这次上传
			if (conf.webdavEnabled && conf.webdavUrl.trim() && conf.webdavUser.trim()) {
				void (async () => {
					try {
						await browser.runtime.sendMessage({
							type: "jt:webdav-settings-put",
							webdavUrl: conf.webdavUrl.trim(),
							webdavUser: conf.webdavUser.trim(),
							webdavPass: conf.webdavPass,
							body: serializeCloudSettings(conf, latestLocale.current),
						});
					} catch {
						// 卸载路径里没有 UI 可提示，失败留给下次打开时的对齐逻辑
					}
				})();
			}
		},
		[],
	);

	// 修改即保存：正则语法错误时不落盘（保留输入与错误提示），其余字段停顿 400ms 写一次
	useEffect(() => {
		if (!ready) return;
		if (savedSignature.current === signature) return;
		const conf = latest.current;
		const regexBroken =
			(conf.customRegex && !isValidRegex(conf.customRegex)) ||
			(conf.codeExcludeRegex && !isValidRegex(conf.codeExcludeRegex));
		if (regexBroken) return;

		const localTimer = setTimeout(() => {
			setSaveState("saving");
			saveSettings(latest.current);
			if (getSavedLocale() !== latestLocale.current) {
				saveLocale(latestLocale.current);
			}
			savedSignature.current = signature;
			setSaveState("saved");
			const translateSig = `${latest.current.translateApiUrl}|${latest.current.translateApiKey}`;
			// 凭据变化（无论是否启用）都重新拉取模型列表（latest 此时已是最新帧）
			if (modelsSignature.current !== translateSig) {
				modelsSignature.current = translateSig;
				void fetchTranslateModels();
			}
		}, SAVE_DEBOUNCE_MS);

		// 云盘开启时同步是保存的一部分，但打字过程不该每个字符都推一次
		const cloudTimer = setTimeout(() => {
			if (!latest.current.webdavEnabled) return;
			const url = latest.current.webdavUrl.trim();
			const user = latest.current.webdavUser.trim();
			if (!url || !user) return;
			void pushCloudSettings().then((pushed) => {
				setCloudStatus(
					pushed.ok
						? { ok: true, text: t.cloudSettingsSynced }
						: { ok: false, text: t.cloudPushFailed(pushed.status) },
				);
			});
		}, CLOUD_DEBOUNCE_MS);

		return () => {
			clearTimeout(localTimer);
			clearTimeout(cloudTimer);
		};
	}, [signature, ready]);

	// 自动保存提示 1.2s 后淡出，避免一直挂着“已保存”
	useEffect(() => {
		if (saveState !== "saved") return;
		const timer = setTimeout(() => setSaveState("idle"), 1200);
		return () => clearTimeout(timer);
	}, [saveState]);

	return {
		t,
		locale,
		// 字段值
		supjav,
		javbus,
		supjavName,
		javdbName,
		customName,
		customTemplate,
		translateApiKey,
		translateModel,
		translateUrl,
		translateEnabled,
		fallbackService,
		translateModels,
		translateModelsLoading,
		translateModelsError,
		translateVerifyError,
		webdavUrl,
		webdavUser,
		webdavPass,
		webdavEnabled,
		webdavError,
		cloudConflict,
		cloudStatus,
		apiUrl,
		apiKey,
		lookupEnabled,
		lookupVerifyError,
		lookupVerifying,
		embyVerifying,
		translateVerifying,
		embyUrl,
		embyApiKey,
		embyEnabled,
		embyVerifyError,
		embyIndexInfo,
		embyTooLarge,
		embyDropFavorites,
		dropFavoritesConfirm,
		dropFavoritesNotice,
		dropFavoritesSyncing,
		localeOption,
		themeOption,
		excludedHosts,
		newHostInput,
		falenoPrefixes,
		newPrefixInput,
		customRegex,
		regexError,
		codeExcludeRegex,
		codeExcludeRegexError,
		previewVolume,
		saveState,
		// setter
		setSupjav,
		setJavbus,
		setSupjavName,
		setJavdbName,
		setCustomName,
		setCustomTemplate,
		setTranslateApiKey,
		setTranslateModel,
		setTranslateUrl,
		setFallbackService,
		setTranslateVerifyError,
		setWebdavUrl,
		setWebdavUser,
		setWebdavPass,
		setWebdavError,
		setApiUrl,
		setApiKey,
		setLookupVerifyError,
		setEmbyUrl,
		setEmbyApiKey,
		setEmbyTooLarge,
		setEmbyVerifyError,
		setNewHostInput,
		setNewPrefixInput,
		setPreviewVolume,
		// 动作
		handleToggleTranslate,
		fetchTranslateModels,
		refreshTranslateModels,
		handleToggleLookup,
		handleToggleEmby,
		handleToggleEmbyDropFavorites,
		handleConfirmDropFavorites,
		handleCancelDropFavorites,
		handleToggleWebdav,
		handleEmbySyncNow,
		handleCodeExcludeRegexChange,
		handleRegexChange,
		handleResetRegex,
		handleLocaleSelect,
		handleThemeSelect,
		handleAddHost,
		handleRemoveHost,
		handleAddPrefix,
		handleRemovePrefix,
		applyCloudSettings,
		handleOverwriteCloud,
		handleReset,
		setRegexError,
		setCodeExcludeRegexError,
	};
}

/** 设置子页消费的状态契约：字段、setter 与动作全部由 useSettingsDraft 提供 */
export type SettingsDraft = ReturnType<typeof useSettingsDraft>;
