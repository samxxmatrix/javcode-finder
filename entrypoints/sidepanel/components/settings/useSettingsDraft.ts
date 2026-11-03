import { useEffect, useRef, useState } from "react";
import type { LocaleMessages } from "../../../../src/lib/locales";
import {
	configSignature,
	DEFAULT_CODE_REGEX,
	DEFAULT_SETTINGS,
	getEffectiveLocale,
	getSavedLocale,
	getSettings,
	isValidRegex,
	normalizeDomain,
	resetSettings,
	saveLocale,
	saveSettings,
	type ExtensionSettings,
	type LocaleOption,
} from "../../../../src/lib/settings";
import type { SupportedLocale } from "../../../../src/lib/types";
import {
	classifyWebdavVerify,
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

/** 本地落盘的防抖时长：连续输入时只在停顿后写一次存储 */
const SAVE_DEBOUNCE_MS = 400;
/** 云端推送的防抖时长：比本地更长，避免每个字符都打一次 WebDAV */
const CLOUD_DEBOUNCE_MS = 1500;

interface UseSettingsDraftOptions {
	locale: SupportedLocale;
	t: LocaleMessages;
	onLocaleChange?: (locale: SupportedLocale) => void;
	onWebdavConnected?: () => void;
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
}: UseSettingsDraftOptions) {
	const [supjav, setSupjav] = useState("");
	const [javbus, setJavbus] = useState("");
	const [supjavName, setSupjavName] = useState(DEFAULT_SETTINGS.supjavName);
	const [javdbName, setJavdbName] = useState(DEFAULT_SETTINGS.javdbName);
	// 自定义平台：无默认配置，空 = 面板不显示按钮
	const [customName, setCustomName] = useState("");
	const [customTemplate, setCustomTemplate] = useState("");
	const [deeplApiKey, setDeeplApiKey] = useState("");
	// 自建 Worker 翻译：地址与开关（默认关闭 = 纯备用服务模式）
	const [translateUrl, setTranslateUrl] = useState("");
	const [translateEnabled, setTranslateEnabled] = useState(false);
	// 备用翻译服务：自建服务未配置或调用失败时的兜底（默认谷歌）
	const [fallbackService, setFallbackService] =
		useState<FallbackService>("google");
	// Worker 用量：数据与基数均由接口返回；null = 未获取（显示 --/--万）
	const [translateUsage, setTranslateUsage] = useState<{
		count: number | null;
		limit: number | null;
	}>({ count: null, limit: null });
	// 开关打开时的验证错误行（可关闭）
	const [translateVerifyError, setTranslateVerifyError] = useState<
		string | null
	>(null);
	// 用量刷新进行中 / 服务离线标记：仅开关启用时才有意义
	const [translateUsageLoading, setTranslateUsageLoading] = useState(false);
	const [translateOffline, setTranslateOffline] = useState(false);
	const [webdavUrl, setWebdavUrl] = useState("");
	const [webdavUser, setWebdavUser] = useState("");
	const [webdavPass, setWebdavPass] = useState("");
	const [showPass, setShowPass] = useState(false);
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
	// DMM 查询 API 配置（地址与 Key 均空 = 未配置）
	const [dmmApiUrl, setDmmApiUrl] = useState("");
	const [dmmApiKey, setDmmApiKey] = useState("");
	const [dmmEnabled, setDmmEnabled] = useState(false);
	const [dmmVerifyError, setDmmVerifyError] = useState<string | null>(null);
	// D2PASS 无码源配置（地址与 Key 均空 = 未配置）
	const [d2passApiUrl, setD2passApiUrl] = useState("");
	const [d2passApiKey, setD2passApiKey] = useState("");
	const [d2passEnabled, setD2passEnabled] = useState(false);
	const [d2passVerifyError, setD2passVerifyError] = useState<string | null>(null);
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
	const [localeOption, setLocaleOption] = useState<LocaleOption>("auto");
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

	// 合并刷新：先健康检查（带 reason 分类），健康再拉用量；
	// 序号守卫防止快速改 url/key 时旧响应覆盖新值；加载/离线态驱动 UI。
	// 默认从 latest 快照取值；云恢复/挂载等异步灌值场景传显式参数，避免读到旧帧。
	const usageSeq = useRef(0);
	const pollTranslateStatus = async (
		urlOverride?: string,
		keyOverride?: string,
		enabledOverride?: boolean,
	) => {
		const enabled = enabledOverride ?? latest.current.translateEnabled;
		const url = (urlOverride ?? latest.current.translateApiUrl).trim();
		const key = (keyOverride ?? latest.current.deeplApiKey).trim();
		// 防御闸：关闭 / 无凭据 一律不调接口 —— 彻底杜绝“关闭仍调接口”
		if (!enabled || !url || !key) return;
		const seq = ++usageSeq.current;
		setTranslateUsageLoading(true);
		try {
			const health = (await browser.runtime.sendMessage({
				type: "jt:health",
				deeplKey: key,
				translateUrl: url,
				locale,
			})) as { ok?: boolean; reason?: string; error?: string } | undefined;
			if (seq !== usageSeq.current) return; // 丢弃过期响应
			const reason = health?.reason ?? "abnormal";
			if (reason === "network" || reason === "server") {
				// 网络层或 5xx：服务不可达，标记离线并清空用量
				setTranslateOffline(true);
				setTranslateUsage({ count: null, limit: null });
				return;
			}
			setTranslateOffline(false);
			if (reason !== "ok") {
				// auth/abnormal/incomplete：接口错误不显示用量
				setTranslateUsage({ count: null, limit: null });
				return;
			}
			const res = (await browser.runtime.sendMessage({
				type: "jt:usage",
				deeplKey: key,
				translateUrl: url,
			})) as { count?: number | null; limit?: number | null } | undefined;
			if (seq !== usageSeq.current) return;
			setTranslateUsage({ count: res?.count ?? null, limit: res?.limit ?? null });
		} catch {
			if (seq !== usageSeq.current) return;
			setTranslateOffline(true);
			setTranslateUsage({ count: null, limit: null });
		} finally {
			if (seq === usageSeq.current) setTranslateUsageLoading(false);
		}
	};

	// 启用开关：打开时先验证接口 /health，成功再拉用量；
	// 验证失败回弹关闭并显示可关闭的错误信息行
	const handleToggleTranslate = async (checked: boolean) => {
		setTranslateVerifyError(null);
		if (!checked) {
			setTranslateEnabled(false);
			// 即时清空用量与状态，避免旧数字残留 / “离线”误显
			setTranslateUsage({ count: null, limit: null });
			setTranslateOffline(false);
			setTranslateUsageLoading(false);
			return;
		}
		const url = translateUrl.trim();
		const key = deeplApiKey.trim();
		if (!url || !key) {
			setTranslateVerifyError(t.translateApiIncomplete);
			setTranslateEnabled(false);
			return;
		}
		try {
			const health = (await browser.runtime.sendMessage({
				type: "jt:health",
				deeplKey: key,
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
			// 健康已通过，顺带刷新用量（显式参数，跳过 latest 旧帧）
			void pollTranslateStatus(url, key, true);
		} catch {
			setTranslateVerifyError(`${t.verifyFailed}：${t.networkError}`);
			setTranslateEnabled(false);
		}
	};

	// DMM 开关：与 D2PASS 一致，打开时只做“地址与 Key 非空”的即时校验，不再调接口验证
	const handleToggleDmm = async (checked: boolean) => {
		setDmmVerifyError(null);
		if (!checked) {
			setDmmEnabled(false);
			return;
		}
		const url = dmmApiUrl.trim();
		const key = dmmApiKey.trim();
		if (!url || !key) {
			setDmmVerifyError(t.dmmIncomplete);
			setDmmEnabled(false);
			return;
		}
		setDmmEnabled(true);
	};

	// D2PASS 开关：接口没有独立健康检查端点，只做“地址与 Key 非空”的即时校验
	const handleToggleD2pass = async (checked: boolean) => {
		setD2passVerifyError(null);
		if (!checked) {
			setD2passEnabled(false);
			return;
		}
		const url = d2passApiUrl.trim();
		const key = d2passApiKey.trim();
		if (!url || !key) {
			setD2passVerifyError(t.d2passIncomplete);
			setD2passEnabled(false);
			return;
		}
		setD2passEnabled(true);
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

	// 立即同步：强制走一次 background 同步并刷新索引信息
	const handleEmbySyncNow = async () => {
		setEmbyVerifyError(null);
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
				setEmbyVerifyError(
					`${t.embySyncFailed}：${res?.error || t.unknownError}`,
				);
				return;
			}
			// 超额降级：background 不落盘索引（只有逐个番号查询），
			// 所以只提示改用逐个查询，保留原有 syncedAt/total，不伪造一次刚同步的状态
			if (res.mode === "too-large") {
				setEmbyTooLarge(true);
				return;
			}
			setEmbyTooLarge(false);
			setEmbyIndexInfo({
				syncedAt: res.syncedAt ?? Date.now(),
				total: res.total ?? 0,
			});
		} catch {
			setEmbyVerifyError(`${t.embySyncFailed}：${t.networkError}`);
		}
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
		}
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
		setDeeplApiKey(current.deeplApiKey);
		setTranslateUrl(current.translateApiUrl);
		setTranslateEnabled(current.translateEnabled);
		setFallbackService(current.fallbackService);
		setWebdavUrl(current.webdavUrl);
		setWebdavUser(current.webdavUser);
		setWebdavPass(current.webdavPass);
		setWebdavEnabled(current.webdavEnabled);
		setDmmApiUrl(current.dmmApiUrl);
		setDmmApiKey(current.dmmApiKey);
		setDmmEnabled(current.dmmEnabled);
		setD2passApiUrl(current.d2passApiUrl);
		setD2passApiKey(current.d2passApiKey);
		setD2passEnabled(current.d2passEnabled);
		setEmbyUrl(current.embyUrl);
		setEmbyApiKey(current.embyApiKey);
		setEmbyEnabled(current.embyEnabled);
		setLocaleOption(localeOpt);
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
		deeplApiKey,
		translateApiUrl: translateUrl,
		translateEnabled,
		fallbackService,
		dmmApiUrl,
		dmmApiKey,
		dmmEnabled,
		embyUrl,
		embyApiKey,
		embyEnabled,
		webdavUrl,
		webdavUser,
		webdavPass,
		webdavEnabled,
		excludedHosts,
		falenoPrefixes,
		customRegex: customRegex.trim() || DEFAULT_CODE_REGEX,
		d2passApiUrl,
		d2passApiKey,
		d2passEnabled,
		codeExcludeRegex,
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
			void pollTranslateStatus(saved.translateApiUrl, saved.deeplApiKey, true);
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
		setDeeplApiKey("");
		setTranslateUrl("");
		setTranslateEnabled(false);
		setTranslateUsage({ count: null, limit: null });
		setTranslateVerifyError(null);
		setWebdavUrl("");
		setWebdavUser("");
		setWebdavPass("");
		setShowPass(false);
		setWebdavEnabled(false);
		setWebdavError(null);
		setDmmApiUrl("");
		setDmmApiKey("");
		setDmmEnabled(false);
		setDmmVerifyError(null);
		setD2passApiUrl("");
		setD2passApiKey("");
		setD2passEnabled(false);
		setD2passVerifyError(null);
		setEmbyUrl(DEFAULT_SETTINGS.embyUrl);
		setEmbyApiKey(DEFAULT_SETTINGS.embyApiKey);
		setEmbyEnabled(DEFAULT_SETTINGS.embyEnabled);
		setEmbyVerifyError(null);
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
		onLocaleChange?.(getEffectiveLocale("auto"));
		setCloudConflict(null);
		setCloudStatus(null);
	};

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
	const usageSignature = useRef<string | null>(null);

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
		// 挂载只在“已启用”时查用量；显式参数避免读到灌值前的旧帧
		if (current.translateEnabled) {
			void pollTranslateStatus(current.translateApiUrl, current.deeplApiKey, true);
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
			const translateSig = `${latest.current.translateApiUrl}|${latest.current.deeplApiKey}`;
			// 未启用不查用量；签名变化才重新拉取（latest 此时已是最新帧）
			if (
				usageSignature.current !== translateSig &&
				latest.current.translateEnabled
			) {
				usageSignature.current = translateSig;
				void pollTranslateStatus();
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

	// 开启后每 60s 轻量轮询：刷新用量 + 探测服务是否离线（R5/R6）。
	// 依赖 translateEnabled：开启即起、关闭即停；pollTranslateStatus 内部防御闸作二次保险。
	useEffect(() => {
		if (!translateEnabled) return;
		const id = setInterval(() => void pollTranslateStatus(), 60000);
		return () => clearInterval(id);
	}, [translateEnabled]);

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
		deeplApiKey,
		translateUrl,
		translateEnabled,
		fallbackService,
		translateUsage,
		translateUsageLoading,
		translateOffline,
		translateVerifyError,
		webdavUrl,
		webdavUser,
		webdavPass,
		showPass,
		webdavEnabled,
		webdavError,
		cloudConflict,
		cloudStatus,
		dmmApiUrl,
		dmmApiKey,
		dmmEnabled,
		dmmVerifyError,
		d2passApiUrl,
		d2passApiKey,
		d2passEnabled,
		d2passVerifyError,
		embyUrl,
		embyApiKey,
		embyEnabled,
		embyVerifyError,
		embyIndexInfo,
		embyTooLarge,
		localeOption,
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
		setDeeplApiKey,
		setTranslateUrl,
		setFallbackService,
		setTranslateVerifyError,
		setWebdavUrl,
		setWebdavUser,
		setWebdavPass,
		setShowPass,
		setWebdavError,
		setDmmApiUrl,
		setDmmApiKey,
		setDmmVerifyError,
		setD2passApiUrl,
		setD2passApiKey,
		setD2passVerifyError,
		setEmbyUrl,
		setEmbyApiKey,
		setEmbyTooLarge,
		setEmbyVerifyError,
		setNewHostInput,
		setNewPrefixInput,
		setPreviewVolume,
		// 动作
		handleToggleTranslate,
		handleToggleDmm,
		handleToggleD2pass,
		handleToggleEmby,
		handleToggleWebdav,
		handleEmbySyncNow,
		handleCodeExcludeRegexChange,
		handleRegexChange,
		handleResetRegex,
		handleLocaleSelect,
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
