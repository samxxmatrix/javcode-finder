import { detectLocale } from "./locales";
import type { SupportedLocale } from "./types";

export const DEFAULT_CODE_REGEX = "\\b[A-Za-z]{3,6}[-—–\\s]+\\d{3,6}\\b";

// supjav 官方搜索模板按语言区分：中文/繁中走 /zh/ 前缀，英文无前缀
export const SUPJAV_ZH_TEMPLATE = "https://supjav.com/zh/?s={code}";
export const SUPJAV_EN_TEMPLATE = "https://supjav.com/?s={code}";

export interface ExtensionSettings {
	// 空字符串 = 未自定义，跳转时按界面语言选择 supjav 官方模板
	supjavTemplate: string;
	javbusTemplate: string;
	excludedHosts: string[];
	customRegex: string;
	// 预览视频音量（0-100），所有预览播放统一使用
	previewVolume: number;
	// 跳转按钮显示名称（空 = 使用默认名称）
	supjavName: string;
	javdbName: string;
	// DeepL API key（空 = 未配置，标题翻译不可用）
	deeplApiKey: string;
	// WebDAV 云端配置（三项全空 = 未开通云端同步）
	webdavUrl: string;
	webdavUser: string;
	webdavPass: string;
}

export type LocaleOption = "auto" | SupportedLocale;

export const SETTINGS_STORAGE_KEY = "javranking_search_settings";
export const LOCALE_STORAGE_KEY = "javranking_user_locale";

// 旧版本默认跳转 MissAV；若用户从未自定义过该模板，升级后应改用新默认
export const LEGACY_MISSAV_TEMPLATE = "https://missav.ws/cn/{code}";
// 旧版本默认跳转 JavTrailers 搜索页
export const LEGACY_JAVTRAILERS_TEMPLATE = "https://javtrailers.com/search/{code}";

export const DEFAULT_SETTINGS: ExtensionSettings = {
	supjavTemplate: "",
	javbusTemplate: "https://javdb.com/search?q={code}",
	excludedHosts: [],
	customRegex: DEFAULT_CODE_REGEX,
	previewVolume: 100,
	supjavName: "Supjav",
	javdbName: "JavDB",
	deeplApiKey: "",
	webdavUrl: "",
	webdavUser: "",
	webdavPass: "",
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

function getStorage(): Storage | null {
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
			deeplApiKey:
				typeof parsed.deeplApiKey === "string" ? parsed.deeplApiKey.trim() : "",
			webdavUrl:
				typeof parsed.webdavUrl === "string" ? parsed.webdavUrl.trim() : "",
			webdavUser:
				typeof parsed.webdavUser === "string" ? parsed.webdavUser.trim() : "",
			// 密码不做 trim：保持用户输入原样
			webdavPass: typeof parsed.webdavPass === "string" ? parsed.webdavPass : "",
			excludedHosts:
				excludedHosts.length > 0 ? excludedHosts : [...DEFAULT_SETTINGS.excludedHosts],
			customRegex:
				typeof parsed.customRegex === "string" && parsed.customRegex.trim()
					? parsed.customRegex.trim()
					: DEFAULT_SETTINGS.customRegex,
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
				settings.javbusTemplate !== undefined &&
				settings.javbusTemplate.trim()
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
			deeplApiKey:
				settings.deeplApiKey !== undefined
					? settings.deeplApiKey.trim()
					: current.deeplApiKey,
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

export function resolveSearchUrl(template: string, code: string): string {
	const trimmedTemplate = (template || "").trim();
	if (!trimmedTemplate) {
		return `https://javdb.com/search?q=${encodeURIComponent(code)}`;
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

/**
 * 构造 supJAV 跳转 URL：用户自定义模板优先；
 * 模板为空时按界面语言使用官方默认（中文/繁中走 /zh/ 前缀，英文无前缀）。
 */
export function resolveSupjavUrl(
	template: string,
	code: string,
	locale: SupportedLocale,
): string {
	if (template && template.trim()) {
		return resolveSearchUrl(template, code);
	}
	const base = locale === "en" ? SUPJAV_EN_TEMPLATE : SUPJAV_ZH_TEMPLATE;
	return resolveSearchUrl(base, code);
}
