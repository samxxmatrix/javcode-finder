import { detectLocale } from "./locales";
import { normalizePrefix } from "./faleno";
import type { FallbackService } from "./translate";
import type { SupportedLocale } from "./types";

// String.raw 保持反斜杠字面：正则所见即所得（普通字符串中 \b 是退格符、\d 会丢反斜杠）
export const DEFAULT_CODE_REGEX = String.raw`\b(?!(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?:[A-Z]+)?[- —–－\u00A0]+\d{4}\b)(?!\d{4}[- —–－\u00A0]\d{2}[- —–－\u00A0]\d{2}\b)(?<!\d)(?:FC2[- —–－\u00A0]+\d{3,8}|FC2[- —–－\u00A0]+PPV[- —–－\u00A0]+\d{3,8}|FC2PPV[- —–－\u00A0]?\d{3,8}|[A-Z][A-Z0-9]{1,5}[- —–－\u00A0]+\d{3,6})(?![A-Z0-9])`;

export interface ExtensionSettings {
	// 三个外部平台完全同构：无内置品牌/地址，名称与链接规则都由用户配置；
	// 任一为空 = 该平台未配置 → 面板不显示对应按钮
	supjavTemplate: string;
	javbusTemplate: string;
	customTemplate: string;
	supjavName: string;
	javdbName: string;
	customName: string;
	excludedHosts: string[];
	customRegex: string;
	// 无码番号排除正则：匹配候选番号字符串本身（不是页面文本）；留空 = 不排除
	uncensoredExcludeRegex: string;
	// 预览视频音量（0-100），所有预览播放统一使用
	previewVolume: number;
	// DeepL 自建 Worker 翻译（Bearer key 即为 CLIENT_API_KEY）
	deeplApiKey: string;
	// Worker 地址（空 = 未配置，直接用谷歌翻译）
	translateApiUrl: string;
	// 启用开关：关闭时跳过 Worker，直接走备用翻译服务
	translateEnabled: boolean;
	// 备用翻译服务：Worker 失败/未配置时兜底（谷歌或微软 Edge 内置接口）
	fallbackService: FallbackService;
	// WebDAV 云端配置（三项全空 = 未配置云端）
	webdavUrl: string;
	webdavUser: string;
	webdavPass: string;
	// 云盘同步开关：关闭时不存取云端（收藏仅本地）
	webdavEnabled: boolean;
	// DMM 查询 API 配置（地址与 Key 均空 = 未配置，走 javtrailers 默认链路）
	dmmApiUrl: string;
	dmmApiKey: string;
	// DMM 开关：打开时预览/详情优先走 DMM API，javtrailers 兜底
	dmmEnabled: boolean;
	// D2PASS 无码源配置（地址与 Key 均空 = 未配置）；开关关闭 = 回到接入前的行为
	d2passApiUrl: string;
	d2passApiKey: string;
	d2passEnabled: boolean;
	// FALENO 官方兜底番号头:番号以任一前缀开头时,DMM 与 JavTrailers 均查不到则回退 faleno.jp;空数组 = 不启用
	falenoPrefixes: string[];
	// Emby 媒体库（URL 与 API Key 均空 = 未配置，面板不显示在库标识）
	embyUrl: string;
	embyApiKey: string;
	embyEnabled: boolean;
}

export type LocaleOption = "auto" | SupportedLocale;

export const SETTINGS_STORAGE_KEY = "javranking_search_settings";
export const LOCALE_STORAGE_KEY = "javranking_user_locale";

// 旧版本默认跳转 MissAV；若用户从未自定义过该模板，升级后应改用新默认（空 = 未配置）
export const LEGACY_MISSAV_TEMPLATE = "https://missav.ws/cn/{code}";
// 旧版本默认跳转 JavTrailers 搜索页
export const LEGACY_JAVTRAILERS_TEMPLATE = "https://javtrailers.com/search/{code}";

export const DEFAULT_SETTINGS: ExtensionSettings = {
	// 三个平台默认都未配置：名称与链接规则均为空，面板不显示按钮
	supjavName: "",
	javdbName: "",
	customName: "",
	supjavTemplate: "",
	javbusTemplate: "",
	customTemplate: "",
	excludedHosts: [],
	customRegex: DEFAULT_CODE_REGEX,
	uncensoredExcludeRegex: "",
	previewVolume: 100,
	deeplApiKey: "",
	translateApiUrl: "",
	translateEnabled: false,
	fallbackService: "google",
	webdavUrl: "",
	webdavUser: "",
	webdavPass: "",
	webdavEnabled: false,
	dmmApiUrl: "",
	dmmApiKey: "",
	dmmEnabled: false,
	d2passApiUrl: "",
	d2passApiKey: "",
	d2passEnabled: false,
	falenoPrefixes: ["FNS"],
	embyUrl: "",
	embyApiKey: "",
	embyEnabled: false,
};

export function normalizeDomain(input: string): string {
	let str = (input || "").trim().toLowerCase();
	if (!str) return "";
	str = str.replace(/^[a-z]+:\/\//i, "");
	str = str.split("/")[0]?.split("?")[0]?.split("#")[0] ?? "";
	str = str.split(":")[0] ?? "";
	str = str.replace(/^\.+|\.+$/g, "");
	return str;
}

export function isHostExcluded(
	targetUrlOrHost: string,
	excludedHosts: string[],
): boolean {
	if (!targetUrlOrHost || !excludedHosts || excludedHosts.length === 0) {
		return false;
	}
	let host = targetUrlOrHost.trim().toLowerCase();
	try {
		if (host.includes("://")) {
			host = new URL(host).hostname.toLowerCase();
		} else {
			host = normalizeDomain(host);
		}
	} catch {
		host = normalizeDomain(host);
	}
	if (!host) return false;

	return excludedHosts.some((excluded) => {
		const normExcluded = normalizeDomain(excluded);
		if (!normExcluded) return false;
		return host === normExcluded || host.endsWith("." + normExcluded);
	});
}

export function isValidRegex(pattern: string): boolean {
	if (!pattern || !pattern.trim()) return false;
	try {
		new RegExp(pattern.trim(), "gi");
		return true;
	} catch {
		return false;
	}
}

export function getStorage(): Storage | null {
	try {
		if (typeof localStorage !== "undefined") {
			return localStorage;
		}
		if (typeof window !== "undefined" && window.localStorage) {
			return window.localStorage;
		}
	} catch {
		// Ignore access errors
	}
	return null;
}

export function getSettings(): ExtensionSettings {
	try {
		const storage = getStorage();
		if (!storage) {
			return { ...DEFAULT_SETTINGS };
		}
		const raw = storage.getItem(SETTINGS_STORAGE_KEY);
		if (!raw) {
			return { ...DEFAULT_SETTINGS };
		}
		const parsed = JSON.parse(raw);
		const excludedHosts = Array.isArray(parsed.excludedHosts)
			? parsed.excludedHosts
					.map((h: unknown) => (typeof h === "string" ? normalizeDomain(h) : ""))
					.filter(Boolean)
			: DEFAULT_SETTINGS.excludedHosts;

		// 旧字段迁移链：supjavTemplate → javtrailersTemplate → missavTemplate。
		// 用户自定义过（≠ 各自旧默认值）则保留为 supjav 模板，否则用新默认（空 = 跟随语言）。
		const legacyMissav =
			typeof parsed.missavTemplate === "string" && parsed.missavTemplate.trim()
				? parsed.missavTemplate.trim()
				: null;
		const legacyJavtrailers =
			typeof parsed.javtrailersTemplate === "string" &&
			parsed.javtrailersTemplate.trim()
				? parsed.javtrailersTemplate.trim()
				: null;
		const migratedTemplate =
			legacyJavtrailers &&
			legacyJavtrailers !== LEGACY_JAVTRAILERS_TEMPLATE
				? legacyJavtrailers
				: legacyMissav && legacyMissav !== LEGACY_MISSAV_TEMPLATE
					? legacyMissav
					: DEFAULT_SETTINGS.supjavTemplate;

		return {
			supjavTemplate:
				typeof parsed.supjavTemplate === "string" &&
				parsed.supjavTemplate.trim()
					? parsed.supjavTemplate.trim()
					: migratedTemplate,
			javbusTemplate:
				typeof parsed.javbusTemplate === "string" &&
				parsed.javbusTemplate.trim()
					? parsed.javbusTemplate.trim()
					: DEFAULT_SETTINGS.javbusTemplate,
			previewVolume:
				typeof parsed.previewVolume === "number" &&
				parsed.previewVolume >= 0 &&
				parsed.previewVolume <= 100
					? parsed.previewVolume
					: DEFAULT_SETTINGS.previewVolume,
			supjavName:
				typeof parsed.supjavName === "string" && parsed.supjavName.trim()
					? parsed.supjavName.trim()
					: DEFAULT_SETTINGS.supjavName,
			javdbName:
				typeof parsed.javdbName === "string" && parsed.javdbName.trim()
					? parsed.javdbName.trim()
					: DEFAULT_SETTINGS.javdbName,
			customName:
				typeof parsed.customName === "string" ? parsed.customName.trim() : "",
			customTemplate:
				typeof parsed.customTemplate === "string"
					? parsed.customTemplate.trim()
					: "",
			deeplApiKey:
				typeof parsed.deeplApiKey === "string" ? parsed.deeplApiKey.trim() : "",
			translateApiUrl:
				typeof parsed.translateApiUrl === "string"
					? parsed.translateApiUrl.trim()
					: "",
			translateEnabled:
				typeof parsed.translateEnabled === "boolean"
					? parsed.translateEnabled
					: DEFAULT_SETTINGS.translateEnabled,
			fallbackService:
				parsed.fallbackService === "bing" ? "bing" : "google",
			webdavUrl:
				typeof parsed.webdavUrl === "string" ? parsed.webdavUrl.trim() : "",
			webdavUser:
				typeof parsed.webdavUser === "string" ? parsed.webdavUser.trim() : "",
			// 密码不做 trim：保持用户输入原样
			webdavPass: typeof parsed.webdavPass === "string" ? parsed.webdavPass : "",
			webdavEnabled:
				typeof parsed.webdavEnabled === "boolean"
					? parsed.webdavEnabled
					: DEFAULT_SETTINGS.webdavEnabled,
			dmmApiUrl:
				typeof parsed.dmmApiUrl === "string" ? parsed.dmmApiUrl.trim() : "",
			dmmApiKey:
				typeof parsed.dmmApiKey === "string" ? parsed.dmmApiKey.trim() : "",
			dmmEnabled:
				typeof parsed.dmmEnabled === "boolean"
					? parsed.dmmEnabled
					: DEFAULT_SETTINGS.dmmEnabled,
			d2passApiUrl:
				typeof parsed.d2passApiUrl === "string"
					? parsed.d2passApiUrl.trim()
					: "",
			d2passApiKey:
				typeof parsed.d2passApiKey === "string"
					? parsed.d2passApiKey.trim()
					: "",
			d2passEnabled:
				typeof parsed.d2passEnabled === "boolean"
					? parsed.d2passEnabled
					: DEFAULT_SETTINGS.d2passEnabled,
			// 旧存储无此字段时补默认;字段存在但为空数组 = 用户主动关闭兜底,保持为空
			falenoPrefixes: Array.isArray(parsed.falenoPrefixes)
				? parsed.falenoPrefixes
						.map((p: unknown) =>
							typeof p === "string" ? normalizePrefix(p) : "",
						)
						.filter(Boolean)
				: [...DEFAULT_SETTINGS.falenoPrefixes],
			embyUrl: typeof parsed.embyUrl === "string" ? parsed.embyUrl.trim() : "",
			embyApiKey:
				typeof parsed.embyApiKey === "string" ? parsed.embyApiKey.trim() : "",
			embyEnabled:
				typeof parsed.embyEnabled === "boolean"
					? parsed.embyEnabled
					: DEFAULT_SETTINGS.embyEnabled,
			excludedHosts:
				excludedHosts.length > 0 ? excludedHosts : [...DEFAULT_SETTINGS.excludedHosts],
			customRegex:
				typeof parsed.customRegex === "string" && parsed.customRegex.trim()
					? parsed.customRegex.trim()
					: DEFAULT_SETTINGS.customRegex,
			// 手工写坏的非法正则读回时降级为空：注入端不能因为一个坏正则整页失败
			uncensoredExcludeRegex:
				typeof parsed.uncensoredExcludeRegex === "string" &&
				parsed.uncensoredExcludeRegex.trim() &&
				isValidRegex(parsed.uncensoredExcludeRegex)
					? parsed.uncensoredExcludeRegex.trim()
					: DEFAULT_SETTINGS.uncensoredExcludeRegex,
		};
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function saveSettings(
	settings: Partial<ExtensionSettings>,
): ExtensionSettings {
	try {
		const current = getSettings();
		const updated: ExtensionSettings = {
			// 传入空字符串表示"恢复默认（跟随语言）"，因此与未传字段区分处理
			supjavTemplate:
				settings.supjavTemplate !== undefined
					? settings.supjavTemplate.trim()
					: current.supjavTemplate,
			javbusTemplate:
				settings.javbusTemplate !== undefined
					? settings.javbusTemplate.trim()
					: current.javbusTemplate,
			excludedHosts:
				settings.excludedHosts !== undefined
					? Array.from(
							new Set(
								settings.excludedHosts
									.map(normalizeDomain)
									.filter(Boolean),
							),
						)
					: current.excludedHosts,
			customRegex:
				settings.customRegex !== undefined && settings.customRegex.trim()
					? settings.customRegex.trim()
					: current.customRegex,
			previewVolume:
				settings.previewVolume !== undefined &&
				settings.previewVolume >= 0 &&
				settings.previewVolume <= 100
					? settings.previewVolume
					: current.previewVolume,
			supjavName:
				settings.supjavName !== undefined
					? settings.supjavName.trim()
					: current.supjavName,
			javdbName:
				settings.javdbName !== undefined
					? settings.javdbName.trim()
					: current.javdbName,
			customName:
				settings.customName !== undefined
					? settings.customName.trim()
					: current.customName,
			customTemplate:
				settings.customTemplate !== undefined
					? settings.customTemplate.trim()
					: current.customTemplate,
			deeplApiKey:
				settings.deeplApiKey !== undefined
					? settings.deeplApiKey.trim()
					: current.deeplApiKey,
			translateApiUrl:
				settings.translateApiUrl !== undefined
					? settings.translateApiUrl.trim()
					: current.translateApiUrl,
			translateEnabled:
				settings.translateEnabled !== undefined
					? settings.translateEnabled
					: current.translateEnabled,
			fallbackService:
				settings.fallbackService !== undefined
					? settings.fallbackService === "bing"
						? "bing"
						: "google"
					: current.fallbackService,
			// 云端三项传入空字符串表示"关闭云端同步"，与未传字段区分处理
			webdavUrl:
				settings.webdavUrl !== undefined
					? settings.webdavUrl.trim()
					: current.webdavUrl,
			webdavUser:
				settings.webdavUser !== undefined
					? settings.webdavUser.trim()
					: current.webdavUser,
			webdavPass:
				settings.webdavPass !== undefined
					? settings.webdavPass
					: current.webdavPass,
			webdavEnabled:
				settings.webdavEnabled !== undefined
					? settings.webdavEnabled
					: current.webdavEnabled,
			dmmApiUrl:
				settings.dmmApiUrl !== undefined
					? settings.dmmApiUrl.trim()
					: current.dmmApiUrl,
			dmmApiKey:
				settings.dmmApiKey !== undefined
					? settings.dmmApiKey.trim()
					: current.dmmApiKey,
			dmmEnabled:
				settings.dmmEnabled !== undefined
					? settings.dmmEnabled
					: current.dmmEnabled,
			d2passApiUrl:
				typeof settings.d2passApiUrl === "string"
					? settings.d2passApiUrl.trim()
					: current.d2passApiUrl,
			d2passApiKey:
				typeof settings.d2passApiKey === "string"
					? settings.d2passApiKey.trim()
					: current.d2passApiKey,
			d2passEnabled:
				settings.d2passEnabled !== undefined
					? settings.d2passEnabled
					: current.d2passEnabled,
			// 非法正则不落盘：丢弃本次输入、保留旧值（留空是合法值，= 不排除）
			uncensoredExcludeRegex:
				typeof settings.uncensoredExcludeRegex === "string" &&
				(!settings.uncensoredExcludeRegex.trim() ||
					isValidRegex(settings.uncensoredExcludeRegex))
					? settings.uncensoredExcludeRegex.trim()
					: current.uncensoredExcludeRegex,
			// 与读取端一致的宽松校验：外部传入 null/非字符串时保留原值，不让整次保存抛错被吞
			embyUrl:
				typeof settings.embyUrl === "string"
					? settings.embyUrl.trim()
					: current.embyUrl,
			embyApiKey:
				typeof settings.embyApiKey === "string"
					? settings.embyApiKey.trim()
					: current.embyApiKey,
			embyEnabled:
				settings.embyEnabled !== undefined
					? settings.embyEnabled
					: current.embyEnabled,
			falenoPrefixes:
				settings.falenoPrefixes !== undefined
					? Array.from(
							new Set(
								settings.falenoPrefixes
									.map(normalizePrefix)
									.filter(Boolean),
							),
						)
					: current.falenoPrefixes,
		};
		const storage = getStorage();
		if (storage) {
			storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
		}
		return updated;
	} catch {
		return getSettings();
	}
}

export function resetSettings(): ExtensionSettings {
	try {
		const storage = getStorage();
		if (storage) {
			storage.setItem(
				SETTINGS_STORAGE_KEY,
				JSON.stringify(DEFAULT_SETTINGS),
			);
		}
	} catch {
		// Ignore storage write errors
	}
	return { ...DEFAULT_SETTINGS };
}

export function getSavedLocale(): LocaleOption {
	try {
		const storage = getStorage();
		if (!storage) return "auto";
		const val = storage.getItem(LOCALE_STORAGE_KEY);
		if (val === "zh-hans" || val === "zh-hant" || val === "en") {
			return val;
		}
		return "auto";
	} catch {
		return "auto";
	}
}

export function saveLocale(locale: LocaleOption): void {
	try {
		const storage = getStorage();
		if (storage) {
			storage.setItem(LOCALE_STORAGE_KEY, locale);
		}
	} catch {
		// Ignore write error
	}
}

export function getEffectiveLocale(savedOption?: LocaleOption): SupportedLocale {
	const opt = savedOption !== undefined ? savedOption : getSavedLocale();
	if (opt === "zh-hans" || opt === "zh-hant" || opt === "en") {
		return opt;
	}
	return detectLocale();
}

/**
 * 平台是否已配置：名称与链接规则都非空才成立。
 * 三个平台同构，未配置的平台在面板上不显示跳转按钮。
 */
export function isPlatformConfigured(name: string, template: string): boolean {
	return Boolean((name || "").trim() && (template || "").trim());
}

export type PlatformKey = "supjav" | "javdb" | "custom";

export interface PlatformLink {
	key: PlatformKey;
	/** trim 后的平台名称（按钮正文取首字符，title 用全名） */
	name: string;
	/** trim 后的链接规则模板（交给 resolveSearchUrl 生成跳转地址） */
	template: string;
}

/**
 * 面板上要显示的外部平台跳转按钮（最多三个）：名称与链接规则都非空的平台，
 * 顺序固定 supjav → javdb → custom。
 *
 * 番号列表区与预告片头部共用这一份显示规则 —— 两处各写一遍判断迟早会漂移
 * （历史上来源判定就漏登记过一次）。
 */
export function configuredPlatforms(
	settings: ExtensionSettings,
): PlatformLink[] {
	const candidates: PlatformLink[] = [
		{
			key: "supjav",
			name: settings.supjavName,
			template: settings.supjavTemplate,
		},
		{
			key: "javdb",
			name: settings.javdbName,
			template: settings.javbusTemplate,
		},
		{
			key: "custom",
			name: settings.customName,
			template: settings.customTemplate,
		},
	];
	const platforms: PlatformLink[] = [];
	for (const candidate of candidates) {
		const name = (candidate.name || "").trim();
		const template = (candidate.template || "").trim();
		if (isPlatformConfigured(name, template)) {
			platforms.push({ key: candidate.key, name, template });
		}
	}
	return platforms;
}

/**
 * 方形平台按钮的正文：平台名首字符（中文取第一个字符），拉丁字母转大写。
 * 用 Array.from 取字符而不是 charAt：代理对（emoji / 生僻字）不会被截成半个。
 */
export function platformInitial(name: string): string {
	const first = Array.from((name || "").trim())[0];
	return first ? first.toUpperCase() : "";
}

/**
 * 配置签名：把全部可保存配置序列化成一个字符串。
 * 表单当前值的签名 ≠ 已落盘配置的签名 = 有未保存改动（用于“请保存”提醒）。
 * 字符串统一 trim（与 saveSettings 落盘口径一致）、正则按保存时的空值回退口径归一，
 * 避免保存后因首尾空白等差异残留提醒。
 */
export function configSignature(settings: ExtensionSettings): string {
	const trim = (value: string) => (value || "").trim();
	return JSON.stringify([
		trim(settings.supjavName),
		trim(settings.supjavTemplate),
		trim(settings.javdbName),
		trim(settings.javbusTemplate),
		trim(settings.customName),
		trim(settings.customTemplate),
		settings.previewVolume,
		trim(settings.deeplApiKey),
		trim(settings.translateApiUrl),
		settings.translateEnabled,
		settings.fallbackService,
		trim(settings.dmmApiUrl),
		trim(settings.dmmApiKey),
		settings.dmmEnabled,
		trim(settings.d2passApiUrl),
		trim(settings.d2passApiKey),
		settings.d2passEnabled,
		trim(settings.uncensoredExcludeRegex),
		trim(settings.embyUrl),
		trim(settings.embyApiKey),
		settings.embyEnabled,
		trim(settings.webdavUrl),
		trim(settings.webdavUser),
		// 密码按原样比较：保存时不做 trim
		settings.webdavPass,
		settings.webdavEnabled,
		settings.excludedHosts,
		settings.falenoPrefixes,
		trim(settings.customRegex) || DEFAULT_CODE_REGEX,
	]);
}

/**
 * 用链接规则模板生成跳转 URL。
 * 模板为空 = 该平台未配置：不生成链接（返回空串），面板也不会显示对应按钮。
 */
export function resolveSearchUrl(template: string, code: string): string {
	const trimmedTemplate = (template || "").trim();
	if (!trimmedTemplate) {
		return "";
	}

	const encoded = encodeURIComponent(code);

	// Check for placeholder patterns: {code}, {番号}, {ID}
	if (/\{(?:code|番号|id)\}/i.test(trimmedTemplate)) {
		return trimmedTemplate.replace(/\{(?:code|番号|id)\}/gi, encoded);
	}

	// No placeholder: append code cleanly
	if (trimmedTemplate.endsWith("=") || trimmedTemplate.endsWith("/")) {
		return `${trimmedTemplate}${encoded}`;
	}

	if (trimmedTemplate.includes("?")) {
		return `${trimmedTemplate}&q=${encoded}`;
	}

	return `${trimmedTemplate}/${encoded}`;
}
