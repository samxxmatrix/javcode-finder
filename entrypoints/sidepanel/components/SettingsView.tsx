import React, {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useState,
} from "react";
import type { LocaleMessages } from "../../../src/lib/locales";
import {
	DEFAULT_CODE_REGEX,
	DEFAULT_SETTINGS,
	getEffectiveLocale,
	getSavedLocale,
	getSettings,
	isValidRegex,
	normalizeDomain,
	resetSettings,
	resolveSearchUrl,
	resolveSupjavUrl,
	saveLocale,
	saveSettings,
	SUPJAV_EN_TEMPLATE,
	SUPJAV_ZH_TEMPLATE,
	type LocaleOption,
} from "../../../src/lib/settings";
import type { SupportedLocale } from "../../../src/lib/types";
import { classifyWebdavVerify, type WebdavVerifyResult } from "../../../src/lib/favorites";
import { formatUsage, type FallbackService } from "../../../src/lib/translate";
import { normalizePrefix } from "../../../src/lib/faleno";
import { browserEmbyStore, loadEmbyIndex } from "../../../src/lib/emby-index";
import { ClearButton } from "./ClearButton";

interface SettingsViewProps {
	locale: SupportedLocale;
	t: LocaleMessages;
	onBack: () => void;
	onLocaleChange?: (locale: SupportedLocale) => void;
	// 云端验证通过（即"开通云端同步"）后回调，由 App 执行首次同步
	onWebdavConnected?: () => void;
	// Emby 开关立即生效后回调，由 App 重扫列表以显示在库标识
	onEmbyChange?: () => void;
}

// 暴露给顶部图标按钮的保存/重置操作；save 返回是否保存成功（校验或云端验证失败时为 false）
export interface SettingsViewHandle {
	save: () => Promise<boolean>;
	reset: () => void;
}

export const SettingsView = forwardRef<SettingsViewHandle, SettingsViewProps>(
	function SettingsView(
		{ locale, t, onBack, onLocaleChange, onWebdavConnected, onEmbyChange },
		ref,
	) {
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
	// 备用翻译服务：Worker 失败/未配置时兜底（默认谷歌）
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
	const [webdavUrl, setWebdavUrl] = useState("");
	const [webdavUser, setWebdavUser] = useState("");
	const [webdavPass, setWebdavPass] = useState("");
	const [showPass, setShowPass] = useState(false);
	// 云盘同步开关（打开才存取云端，打开时验证）
	const [webdavEnabled, setWebdavEnabled] = useState(false);
	// 云盘验证错误（错误汇总区显示，可关闭）
	const [webdavError, setWebdavError] = useState<string | null>(null);
	// DMM 查询 API 配置（地址与 Key 均空 = 未配置）
	const [dmmApiUrl, setDmmApiUrl] = useState("");
	const [dmmApiKey, setDmmApiKey] = useState("");
	// DMM 开关（打开才优先走 DMM，打开时验证）
	const [dmmEnabled, setDmmEnabled] = useState(false);
	// DMM 验证错误（错误汇总区显示，可关闭）
	const [dmmVerifyError, setDmmVerifyError] = useState<string | null>(null);
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
	const [previewVolume, setPreviewVolume] = useState(DEFAULT_SETTINGS.previewVolume);
	const [savedMessage, setSavedMessage] = useState(false);

	// 当前语言的官方默认模板（输入框为空时显示它，用户视角里输入框始终有具体值）
	const defaultSupjavTemplate =
		locale === "en" ? SUPJAV_EN_TEMPLATE : SUPJAV_ZH_TEMPLATE;

	// 查询 Worker 用量并刷新显示；地址或 key 缺失/请求失败显示 --/--万
	const refreshTranslateUsage = async (url: string, key: string) => {
		if (!url.trim() || !key.trim()) {
			setTranslateUsage({ count: null, limit: null });
			return;
		}
		try {
			const res = (await browser.runtime.sendMessage({
				type: "jt:usage",
				deeplKey: key,
				translateUrl: url,
			})) as { count?: number | null; limit?: number | null } | undefined;
			setTranslateUsage({
				count: res?.count ?? null,
				limit: res?.limit ?? null,
			});
		} catch {
			setTranslateUsage({ count: null, limit: null });
		}
	};

	// 启用开关：打开时先验证接口 /health，成功再拉用量；
	// 验证失败回弹关闭并显示可关闭的错误信息行
	const handleToggleTranslate = async (checked: boolean) => {
		setTranslateVerifyError(null);
		if (!checked) {
			setTranslateEnabled(false);
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
			await refreshTranslateUsage(url, key);
			setTranslateEnabled(true);
		} catch {
			setTranslateVerifyError(`${t.verifyFailed}：${t.networkError}`);
			setTranslateEnabled(false);
		}
	};

	// DMM 开关：打开时先验证接口（cid 查询探针），失败回弹关闭并显示错误行
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
		try {
			const health = (await browser.runtime.sendMessage({
				type: "jt:dmm-health",
				dmmApiUrl: url,
				dmmApiKey: key,
				locale,
			})) as { ok?: boolean; error?: string } | undefined;
			if (!health?.ok) {
				setDmmVerifyError(
					`${t.verifyFailed}：${health?.error || t.unknownError}`,
				);
				setDmmEnabled(false);
				return;
			}
			setDmmEnabled(true);
		} catch {
			setDmmVerifyError(`${t.verifyFailed}：${t.networkError}`);
			setDmmEnabled(false);
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
	// 副作用（验证 + jt:emby-sync 同步索引）在这里立即发生，所以状态也必须立即落盘：
	// 否则面板的 getSettings() 仍读到 embyEnabled:false，会跳过整个在库匹配（看不到标识），
	// 直到用户再点一次保存才生效。每条返回路径都保证落盘值与 embyEnabled 状态一致。
	const handleToggleEmby = async (checked: boolean) => {
		setEmbyVerifyError(null);
		// 未通过验证的路径一律保持关闭并立即落盘（true 只出现在验证成功路径）
		const persistOff = () => {
			setEmbyEnabled(false);
			saveSettings({ embyUrl, embyApiKey, embyEnabled: false });
			onEmbyChange?.();
		};
		if (!checked) {
			persistOff();
			return;
		}
		const url = embyUrl.trim();
		const key = embyApiKey.trim();
		if (!url || !key) {
			setEmbyVerifyError(t.embyIncomplete);
			persistOff();
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
				persistOff();
				return;
			}
			setEmbyEnabled(true);
			// 先同步索引（await 到 background 落盘），再立即持久化开关并通知 App 重扫
			await handleEmbySyncNow();
			saveSettings({ embyUrl, embyApiKey, embyEnabled: true });
			onEmbyChange?.();
		} catch {
			setEmbyVerifyError(`${t.verifyFailed}：${t.networkError}`);
			persistOff();
		}
	};

	useEffect(() => {
		const current = getSettings();
		// 存储为空（跟随语言）时，把当前语言的官方模板填入输入框
		setSupjav(current.supjavTemplate || defaultSupjavTemplate);
		setJavbus(current.javbusTemplate);
		setSupjavName(current.supjavName || DEFAULT_SETTINGS.supjavName);
		setJavdbName(current.javdbName || DEFAULT_SETTINGS.javdbName);
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
		setEmbyUrl(current.embyUrl);
		setEmbyApiKey(current.embyApiKey);
		setEmbyEnabled(current.embyEnabled);
		// 设置页可能在索引读取完成前关闭，卸载后写 state 已无意义
		let cancelled = false;
		void (async () => {
			const index = await loadEmbyIndex(browserEmbyStore());
			if (cancelled) return;
			setEmbyIndexInfo({
				syncedAt: index?.syncedAt ?? null,
				total: index?.total ?? 0,
			});
		})();
		// 打开设置页时展示已保存配置的用量（未配置时显示 --/--万）
		void refreshTranslateUsage(current.translateApiUrl, current.deeplApiKey);
		setLocaleOption(getSavedLocale());
		setExcludedHosts(current.excludedHosts || DEFAULT_SETTINGS.excludedHosts);
		setFalenoPrefixes(current.falenoPrefixes);
		setCustomRegex(current.customRegex || DEFAULT_CODE_REGEX);
		setPreviewVolume(current.previewVolume);
		return () => {
			cancelled = true;
		};
	}, []);

	const handleLocaleSelect = (val: LocaleOption) => {
		setLocaleOption(val);
		saveLocale(val);
		const effective = getEffectiveLocale(val);
		onLocaleChange?.(effective);
		setSavedMessage(true);
		setTimeout(() => {
			setSavedMessage(false);
		}, 2000);
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

	// 云端验证：PROPFIND Depth:0，结果分类交给 classifyWebdavVerify
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

	// 云端验证错误分类 → 界面文案（错误汇总区显示）
	const webdavErrorText: Record<WebdavVerifyResult, string> = {
		ok: t.webdavConnected,
		auth: t.webdavAuthError,
		not_found: t.webdavNotFound,
		rate_limited: t.webdavRateLimited,
		failed: t.webdavConnectError,
	};

	// 云盘同步开关：打开时验证连接，成功开通（触发首次同步）；失败回弹并显示错误汇总
	const handleToggleWebdav = async (checked: boolean) => {
		setWebdavError(null);
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
			onWebdavConnected?.();
		} else {
			setWebdavError(webdavErrorText[result]);
			setWebdavEnabled(false);
		}
	};

	// 保存当前配置（表单提交与顶部图标按钮共用）；返回是否保存成功。
	// 云端验证只在开关打开时执行；保存仅持久化配置。
	const saveCurrent = async (): Promise<boolean> => {
		if (customRegex.trim() && !isValidRegex(customRegex)) {
			setRegexError(t.regexSyntaxError);
			return false;
		}
		// 云端三项必须全空或全填
		const urlTrimmed = webdavUrl.trim();
		const userTrimmed = webdavUser.trim();
		if ((urlTrimmed || userTrimmed || webdavPass) && !(urlTrimmed && userTrimmed)) {
			setWebdavError(t.webdavIncomplete);
			return false;
		}
		saveSettings({
			supjavTemplate: supjav,
			javbusTemplate: javbus,
			excludedHosts,
			customRegex: customRegex.trim() || DEFAULT_CODE_REGEX,
			previewVolume,
			supjavName,
			javdbName,
			customName,
			customTemplate,
			deeplApiKey,
			translateApiUrl: translateUrl,
			translateEnabled,
			fallbackService,
			webdavUrl,
			webdavUser,
			webdavPass,
			webdavEnabled,
			dmmApiUrl,
			dmmApiKey,
			dmmEnabled,
			falenoPrefixes,
			embyUrl,
			embyApiKey,
			embyEnabled,
		});
		// 保存后立即用新配置刷新用量
		void refreshTranslateUsage(translateUrl, deeplApiKey);
		saveLocale(localeOption);
		onLocaleChange?.(getEffectiveLocale(localeOption));
		setSavedMessage(true);
		setTimeout(() => {
			setSavedMessage(false);
		}, 2000);
		return true;
	};

	const handleSave = (e: React.FormEvent) => {
		e.preventDefault();
		void saveCurrent();
	};

	useImperativeHandle(ref, () => ({
		save: saveCurrent,
		reset: handleReset,
	}));

	const handleReset = () => {
		resetSettings();
		// 恢复默认：把当前语言的官方模板填入输入框（而非留空）
		setSupjav(defaultSupjavTemplate);
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
		setPreviewVolume(DEFAULT_SETTINGS.previewVolume);
		setNewHostInput("");
		saveLocale("auto");
		setLocaleOption("auto");
		onLocaleChange?.(getEffectiveLocale("auto"));
		setSavedMessage(true);
		setTimeout(() => {
			setSavedMessage(false);
		}, 2000);
	};

	const sampleCode = "ABP-123";
	const supjavPreview = resolveSupjavUrl(supjav, sampleCode, locale);
	const javbusPreview = resolveSearchUrl(javbus, sampleCode);
	// 自定义平台模板为空时预览显示空（未配置）
	const customPreview = customTemplate.trim()
		? resolveSearchUrl(customTemplate, sampleCode)
		: "";

	return (
		<div className="settings-view">
			<div className="settings-view__header">
				<button
					type="button"
					className="settings-view__back-btn"
					onClick={onBack}
					title={t.backToScanner}
				>
					<svg
						className="icon-back"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<polyline points="15 18 9 12 15 6" />
					</svg>
					<span>{t.backToScanner}</span>
				</button>
				<h2 className="settings-view__title">{t.settingsTitle}</h2>
			</div>

			<p className="settings-view__desc">{t.settingsDesc}</p>
			<section className="settings-version" aria-labelledby="extension-version-label">
				<span id="extension-version-label" className="settings-version__label">
					{t.extensionVersionLabel}
				</span>
				<code className="settings-version__value">
					v{browser.runtime.getManifest().version}
				</code>
			</section>

			{/* 所有错误信息统一显示在版本信息下方，均可关闭 */}
			{(translateVerifyError || regexError || webdavError || dmmVerifyError || embyVerifyError) && (
				<div className="settings-errors" role="alert">
					{translateVerifyError && (
						<div className="settings-field__error settings-field__error--dismissible">
							<span>{translateVerifyError}</span>
							<button
								type="button"
								className="settings-field__error-close"
								onClick={() => setTranslateVerifyError(null)}
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
					{regexError && (
						<div className="settings-field__error settings-field__error--dismissible">
							<span>{regexError}</span>
							<button
								type="button"
								className="settings-field__error-close"
								onClick={() => setRegexError(null)}
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
					{webdavError && (
						<div className="settings-field__error settings-field__error--dismissible">
							<span>{webdavError}</span>
							<button
								type="button"
								className="settings-field__error-close"
								onClick={() => setWebdavError(null)}
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
					{dmmVerifyError && (
						<div className="settings-field__error settings-field__error--dismissible">
							<span>{dmmVerifyError}</span>
							<button
								type="button"
								className="settings-field__error-close"
								onClick={() => setDmmVerifyError(null)}
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
					{embyVerifyError && (
						<div className="settings-field__error settings-field__error--dismissible">
							<span>{embyVerifyError}</span>
							<button
								type="button"
								className="settings-field__error-close"
								onClick={() => setEmbyVerifyError(null)}
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

			<form className="settings-view__form" onSubmit={handleSave}>

				<div className="settings-field">
					<label className="settings-field__label" htmlFor="locale-select">
						{t.languageLabel}
					</label>
					<select
						id="locale-select"
						className="settings-field__select"
						value={localeOption}
						onChange={(e) => handleLocaleSelect(e.target.value as LocaleOption)}
					>
						<option value="auto">{t.languageAuto}</option>
						<option value="zh-hans">简体中文</option>
						<option value="zh-hant">繁體中文</option>
						<option value="en">English</option>
					</select>
				</div>

				<div className="settings-field">
					<label className="settings-field__label" htmlFor="preview-volume">
						{t.previewVolumeLabel}
					</label>
					<div className="settings-field__volume-row">
						<input
							id="preview-volume"
							type="range"
							className="settings-field__range"
							min={0}
							max={100}
							step={1}
							value={previewVolume}
							onChange={(e) => setPreviewVolume(Number(e.target.value))}
						/>
						<span className="settings-field__volume-value">
							{previewVolume}%
						</span>
					</div>
				</div>

				<div className="settings-field">
					<div className="settings-field__header-row">
						<label className="settings-field__label" htmlFor="translate-url">
							{t.translateUrlLabel}
						</label>
						{/* 苹果开关：打开时验证接口可用性并获取用量；关闭时直接使用备用翻译服务 */}
						<label
							className="settings-field__switch"
							title={t.translateEnableLabel}
						>
							<input
								type="checkbox"
								checked={translateEnabled}
								onChange={(e) => void handleToggleTranslate(e.target.checked)}
								aria-label={t.translateEnableLabel}
							/>
							<span
								className="settings-field__switch-track"
								aria-hidden="true"
							/>
						</label>
					</div>
					<div className="settings-field__input-wrap">
						<input
							id="translate-url"
							type="text"
							className="settings-field__input settings-field__input--code"
							value={translateUrl}
							onChange={(e) => setTranslateUrl(e.target.value)}
							placeholder="https://example.com/"
							spellCheck={false}
							autoComplete="off"
						/>
						<ClearButton
							show={Boolean(translateUrl)}
							onClick={() => setTranslateUrl("")}
							title={t.clearInput}
						/>
					</div>
				</div>

				<div className="settings-field">
					<div className="settings-field__header-row">
						<label className="settings-field__label" htmlFor="deepl-key">
							{t.deeplApiKeyLabel}
						</label>
						<span className="settings-field__hint">
							{formatUsage(translateUsage.count, translateUsage.limit)}
						</span>
					</div>
					<div className="settings-field__input-wrap">
						<input
							id="deepl-key"
							type="text"
							className="settings-field__input settings-field__input--code"
							value={deeplApiKey}
							onChange={(e) => setDeeplApiKey(e.target.value)}
							placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
							spellCheck={false}
							autoComplete="off"
						/>
						<ClearButton
							show={Boolean(deeplApiKey)}
							onClick={() => setDeeplApiKey("")}
							title={t.clearInput}
						/>
					</div>
				</div>

				<div className="settings-field">
					<div className="settings-field__header-row">
						<span className="settings-field__label">{t.fallbackServiceLabel}</span>
						{/* 分段按钮：Worker 失败/未配置时的兜底服务（谷歌默认） */}
						<div
							className="settings-field__segment"
							role="group"
							aria-label={t.fallbackServiceLabel}
						>
							<button
								type="button"
								className="settings-field__segment-btn"
								aria-pressed={fallbackService === "google"}
								onClick={() => setFallbackService("google")}
							>
								{t.fallbackGoogle}
							</button>
							<button
								type="button"
								className="settings-field__segment-btn"
								aria-pressed={fallbackService === "bing"}
								onClick={() => setFallbackService("bing")}
							>
								{t.fallbackBing}
							</button>
						</div>
					</div>
				</div>

				<div className="settings-field">
			<div className="settings-field">
				<div className="settings-field__header-row">
					<label className="settings-field__label" htmlFor="dmm-api-url">
						{t.dmmApiUrlLabel}
					</label>
					{/* 苹果开关：打开时验证接口；开启后预览/详情优先走 DMM 官方数据 */}
					<label
						className="settings-field__switch"
						title={t.dmmEnableLabel}
					>
						<input
							type="checkbox"
							checked={dmmEnabled}
							onChange={(e) => void handleToggleDmm(e.target.checked)}
							aria-label={t.dmmEnableLabel}
						/>
						<span
							className="settings-field__switch-track"
							aria-hidden="true"
						/>
					</label>
				</div>
				<div className="settings-field__input-wrap">
					<input
						id="dmm-api-url"
						type="text"
						className="settings-field__input settings-field__input--code"
						value={dmmApiUrl}
						onChange={(e) => setDmmApiUrl(e.target.value)}
						placeholder="https://dmm.0045.kdns.fr"
						spellCheck={false}
						autoComplete="off"
					/>
					<ClearButton
						show={Boolean(dmmApiUrl)}
						onClick={() => setDmmApiUrl("")}
						title={t.clearInput}
					/>
				</div>
			</div>

			<div className="settings-field">
				<div className="settings-field__header-row">
					<label className="settings-field__label" htmlFor="dmm-api-key">
						{t.dmmApiKeyLabel}
					</label>
				</div>
				<div className="settings-field__input-wrap">
					<input
						id="dmm-api-key"
						type="text"
						className="settings-field__input settings-field__input--code"
						value={dmmApiKey}
						onChange={(e) => setDmmApiKey(e.target.value)}
						placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
						spellCheck={false}
						autoComplete="off"
					/>
					<ClearButton
						show={Boolean(dmmApiKey)}
						onClick={() => setDmmApiKey("")}
						title={t.clearInput}
					/>
				</div>
			</div>

					<div className="settings-field">
						<label className="settings-field__label">
							{t.falenoPrefixesLabel}
						</label>
						<p className="settings-field__hint">{t.falenoPrefixesDesc}</p>
						{falenoPrefixes.length > 0 && (
							<div className="excluded-hosts-list">
								{falenoPrefixes.map((prefix) => (
									<span key={prefix} className="excluded-host-chip">
										<span className="excluded-host-chip__name">{prefix}</span>
										<button
											type="button"
											className="excluded-host-chip__remove"
											onClick={() => handleRemovePrefix(prefix)}
											title={`${t.removeSite}: ${prefix}`}
											aria-label={`${t.removeSite}: ${prefix}`}
										>
											&times;
										</button>
									</span>
								))}
							</div>
						)}
						<div className="excluded-hosts-add-row">
							<div className="settings-field__input-wrap">
								<input
									type="text"
									className="settings-field__input excluded-hosts-input"
									value={newPrefixInput}
									onChange={(e) => setNewPrefixInput(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											handleAddPrefix();
										}
									}}
									placeholder={t.falenoPrefixPlaceholder}
									spellCheck={false}
									autoComplete="off"
								/>
								<ClearButton
									show={Boolean(newPrefixInput)}
									onClick={() => setNewPrefixInput("")}
									title={t.clearInput}
								/>
							</div>
							<button
								type="button"
								className="popup-btn popup-btn--secondary excluded-hosts-add-btn"
								onClick={handleAddPrefix}
							>
								{t.addSite}
							</button>
						</div>
					</div>

					<div className="settings-field">
						<div className="settings-field__header-row">
							<label className="settings-field__label" htmlFor="emby-url">
								{t.embyUrlLabel}
							</label>
							{/* 苹果开关：打开时验证地址与 Key；开启后在番号列表与预告片头部显示在库标识 */}
							<label className="settings-field__switch" title={t.embyEnableLabel}>
								<input
									type="checkbox"
									checked={embyEnabled}
									onChange={(e) => void handleToggleEmby(e.target.checked)}
									aria-label={t.embyEnableLabel}
								/>
								<span className="settings-field__switch-track" aria-hidden="true" />
							</label>
						</div>
						<div className="settings-field__input-wrap">
							<input
								id="emby-url"
								type="text"
								className="settings-field__input settings-field__input--code"
								value={embyUrl}
								onChange={(e) => {
									setEmbyUrl(e.target.value);
									// 超额提示是会话内状态，换地址/Key 后旧提示已失效
									setEmbyTooLarge(false);
								}}
								placeholder="http://192.168.0.50:8096"
								spellCheck={false}
								autoComplete="off"
							/>
							<ClearButton
								show={Boolean(embyUrl)}
								onClick={() => setEmbyUrl("")}
								title={t.clearInput}
							/>
						</div>
					</div>

					<div className="settings-field">
						<div className="settings-field__header-row">
							<label className="settings-field__label" htmlFor="emby-api-key">
								{t.embyApiKeyLabel}
							</label>
							{embyIndexInfo.syncedAt !== null && (
								<span className="settings-field__hint settings-field__hint--end">
									{t.embyItemCountLabel(embyIndexInfo.total)}
								</span>
							)}
						</div>
						<div className="settings-field__input-wrap">
							<input
								id="emby-api-key"
								type="text"
								className="settings-field__input settings-field__input--code"
								value={embyApiKey}
								onChange={(e) => {
									setEmbyApiKey(e.target.value);
									// 同上：改 Key 等于换了服务器，超额提示一并清理
									setEmbyTooLarge(false);
								}}
								placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
								spellCheck={false}
								autoComplete="off"
							/>
							<ClearButton
								show={Boolean(embyApiKey)}
								onClick={() => setEmbyApiKey("")}
								title={t.clearInput}
							/>
						</div>
					</div>

					<div className="settings-field">
						<div className="settings-field__header-row">
							<span className="settings-field__label">
								{embyIndexInfo.syncedAt
									? t.embySyncedAtLabel(
											new Date(embyIndexInfo.syncedAt).toLocaleString(),
										)
									: t.embyNotSynced}
							</span>
							<button
								type="button"
								className="popup-btn popup-btn--secondary"
								onClick={() => void handleEmbySyncNow()}
							>
								{t.embySyncNow}
							</button>
						</div>
						{embyTooLarge && (
							<p className="settings-field__hint">{t.embyTooLarge}</p>
						)}
					</div>

					<div className="settings-field__header-row">
						<label className="settings-field__label" htmlFor="webdav-url">
							{t.cloudSyncLabel}
						</label>
						{/* 苹果开关：打开时验证连接；打开才存取云端 */}
						<label
							className="settings-field__switch"
							title={t.cloudSyncLabel}
						>
							<input
								type="checkbox"
								checked={webdavEnabled}
								onChange={(e) => void handleToggleWebdav(e.target.checked)}
								aria-label={t.cloudSyncLabel}
							/>
							<span
								className="settings-field__switch-track"
								aria-hidden="true"
							/>
						</label>
					</div>
					<div className="settings-field__input-wrap">
						<input
							id="webdav-url"
							type="text"
							className="settings-field__input settings-field__input--code"
							value={webdavUrl}
							onChange={(e) => setWebdavUrl(e.target.value)}
							placeholder={t.webdavUrlPlaceholder}
							spellCheck={false}
							autoComplete="off"
						/>
						<ClearButton
							show={Boolean(webdavUrl)}
							onClick={() => setWebdavUrl("")}
							title={t.clearInput}
						/>
					</div>
					<div className="settings-field__input-wrap">
						<input
							id="webdav-user"
							type="text"
							className="settings-field__input"
							value={webdavUser}
							onChange={(e) => setWebdavUser(e.target.value)}
							placeholder={t.webdavUserPlaceholder}
							spellCheck={false}
							autoComplete="off"
						/>
						<ClearButton
							show={Boolean(webdavUser)}
							onClick={() => setWebdavUser("")}
							title={t.clearInput}
						/>
					</div>
					<div className="webdav-pass-row">
						<div className="settings-field__input-wrap">
							<input
								id="webdav-pass"
								type={showPass ? "text" : "password"}
								className="settings-field__input"
								value={webdavPass}
								onChange={(e) => setWebdavPass(e.target.value)}
								placeholder={t.webdavPassPlaceholder}
								autoComplete="off"
							/>
							<ClearButton
								show={Boolean(webdavPass)}
								onClick={() => setWebdavPass("")}
								title={t.clearInput}
							/>
						</div>
						<button
							type="button"
							className="webdav-pass-toggle"
							onClick={() => setShowPass(!showPass)}
							title={showPass ? t.hidePassword : t.showPassword}
							aria-label={showPass ? t.hidePassword : t.showPassword}
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								width="15"
								height="15"
								aria-hidden="true"
							>
								<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
								<circle cx="12" cy="12" r="3" />
							</svg>
						</button>
					</div>
				</div>

				<div className="settings-field">
					<label className="settings-field__label">
						{t.excludedSitesLabel}
					</label>
					<p className="settings-field__hint">{t.excludedSitesDesc}</p>
					{excludedHosts.length > 0 && (
						<div className="excluded-hosts-list">
							{excludedHosts.map((host) => (
								<span key={host} className="excluded-host-chip">
									<span className="excluded-host-chip__name">{host}</span>
									<button
										type="button"
										className="excluded-host-chip__remove"
										onClick={() => handleRemoveHost(host)}
										title={`${t.removeSite}: ${host}`}
										aria-label={`${t.removeSite}: ${host}`}
									>
										&times;
									</button>
								</span>
							))}
						</div>
					)}
					<div className="excluded-hosts-add-row">
						<div className="settings-field__input-wrap">
							<input
								type="text"
								className="settings-field__input excluded-hosts-input"
								value={newHostInput}
								onChange={(e) => setNewHostInput(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										handleAddHost();
									}
								}}
								placeholder={t.sitePlaceholder}
								spellCheck={false}
								autoComplete="off"
							/>
							<ClearButton
								show={Boolean(newHostInput)}
								onClick={() => setNewHostInput("")}
								title={t.clearInput}
							/>
						</div>
						<button
							type="button"
							className="popup-btn popup-btn--secondary excluded-hosts-add-btn"
							onClick={handleAddHost}
						>
							{t.addSite}
						</button>
					</div>
				</div>

				<div className="settings-field">
					<div className="settings-field__header-row">
						<label className="settings-field__label" htmlFor="custom-regex">
							{t.customRegexLabel}
						</label>
						<button
							type="button"
							className="settings-field__reset-link"
							onClick={handleResetRegex}
						>
							{t.resetRegex}
						</button>
					</div>
					<p className="settings-field__hint">{t.customRegexDesc}</p>
					<div className="settings-field__input-wrap">
						<input
							id="custom-regex"
							type="text"
							className={`settings-field__input settings-field__input--code ${
								regexError ? "settings-field__input--error" : ""
							}`}
							value={customRegex}
							onChange={(e) => handleRegexChange(e.target.value)}
							placeholder={DEFAULT_CODE_REGEX}
							spellCheck={false}
							autoComplete="off"
						/>
						<ClearButton
							show={Boolean(customRegex)}
							onClick={() => handleRegexChange("")}
							title={t.clearInput}
						/>
					</div>
				</div>

				<div className="settings-field">
					<label className="settings-field__label" htmlFor="supjav-name">
						{t.platformNameLabel}
					</label>
					<div className="settings-field__input-wrap">
						<input
							id="supjav-name"
							type="text"
							className="settings-field__input"
							value={supjavName}
							onChange={(e) => setSupjavName(e.target.value)}
							placeholder={DEFAULT_SETTINGS.supjavName}
							spellCheck={false}
							autoComplete="off"
						/>
						<ClearButton
							show={Boolean(supjavName)}
							onClick={() => setSupjavName("")}
							title={t.clearInput}
						/>
					</div>
				</div>

				<div className="settings-field">
					<label className="settings-field__label" htmlFor="supjav-template">
						{t.platformUrlLabel(supjavName || DEFAULT_SETTINGS.supjavName)}
					</label>
					<div className="settings-field__input-wrap">
						<input
							id="supjav-template"
							type="text"
							className="settings-field__input"
							value={supjav}
							onChange={(e) => setSupjav(e.target.value)}
							placeholder={
								locale === "en" ? SUPJAV_EN_TEMPLATE : SUPJAV_ZH_TEMPLATE
							}
							spellCheck={false}
							autoComplete="off"
						/>
						<ClearButton
							show={Boolean(supjav)}
							onClick={() => setSupjav("")}
							title={t.clearInput}
						/>
					</div>
					<div className="settings-field__preview">
						<span className="settings-field__preview-label">
							{t.previewUrlLabel}
						</span>
						<span className="settings-field__preview-url" title={supjavPreview}>
							{supjavPreview}
						</span>
					</div>
				</div>

				<div className="settings-field">
					<label className="settings-field__label" htmlFor="javdb-name">
						{t.platformNameLabel}
					</label>
					<div className="settings-field__input-wrap">
						<input
							id="javdb-name"
							type="text"
							className="settings-field__input"
							value={javdbName}
							onChange={(e) => setJavdbName(e.target.value)}
							placeholder={DEFAULT_SETTINGS.javdbName}
							spellCheck={false}
							autoComplete="off"
						/>
						<ClearButton
							show={Boolean(javdbName)}
							onClick={() => setJavdbName("")}
							title={t.clearInput}
						/>
					</div>
				</div>

				<div className="settings-field">
					<label className="settings-field__label" htmlFor="javbus-template">
						{t.platformUrlLabel(javdbName || DEFAULT_SETTINGS.javdbName)}
					</label>
					<div className="settings-field__input-wrap">
						<input
							id="javbus-template"
							type="text"
							className="settings-field__input"
							value={javbus}
							onChange={(e) => setJavbus(e.target.value)}
							placeholder={DEFAULT_SETTINGS.javbusTemplate}
							spellCheck={false}
							autoComplete="off"
						/>
						<ClearButton
							show={Boolean(javbus)}
							onClick={() => setJavbus("")}
							title={t.clearInput}
						/>
					</div>
					<div className="settings-field__preview">
						<span className="settings-field__preview-label">
							{t.previewUrlLabel}
						</span>
						<span className="settings-field__preview-url" title={javbusPreview}>
							{javbusPreview}
						</span>
					</div>
				</div>

				<div className="settings-field">
					<label className="settings-field__label" htmlFor="custom-name">
						{t.platformNameLabel}
					</label>
					<div className="settings-field__input-wrap">
						<input
							id="custom-name"
							type="text"
							className="settings-field__input"
							value={customName}
							onChange={(e) => setCustomName(e.target.value)}
							spellCheck={false}
							autoComplete="off"
						/>
						<ClearButton
							show={Boolean(customName)}
							onClick={() => setCustomName("")}
							title={t.clearInput}
						/>
					</div>
				</div>

				<div className="settings-field">
					<label className="settings-field__label" htmlFor="custom-template">
						{t.platformUrlLabel(customName || t.customPlatformName)}
					</label>
					<div className="settings-field__input-wrap">
						<input
							id="custom-template"
							type="text"
							className="settings-field__input"
							value={customTemplate}
							onChange={(e) => setCustomTemplate(e.target.value)}
							placeholder="https://example.com/search?q={code}"
							spellCheck={false}
							autoComplete="off"
						/>
						<ClearButton
							show={Boolean(customTemplate)}
							onClick={() => setCustomTemplate("")}
							title={t.clearInput}
						/>
					</div>
					<div className="settings-field__preview">
						<span className="settings-field__preview-label">
							{t.previewUrlLabel}
						</span>
						<span className="settings-field__preview-url" title={customPreview}>
							{customPreview}
						</span>
					</div>
				</div>

				{savedMessage && (
					<span className="settings-view__saved-toast" role="status">
						{t.settingsSaved}
					</span>
				)}
			</form>
		</div>
		);
	},
);
