/**
 * 配置云端同步的数据层：云端 settings.json 的序列化、解析，以及
 * "从云端恢复 / 覆盖云端" 的决策。全部为纯函数，网络请求在 background 执行。
 */

import {
	configSignature,
	DEFAULT_SETTINGS,
	normalizeSettings,
	type ExtensionSettings,
	type LocaleOption,
} from "./settings";

/** 云端配置文件格式版本；将来结构变更时据此迁移 */
export const CLOUD_SETTINGS_VERSION = 1;

export interface CloudSettings {
	/** 归一化后的完整配置（缺字段已按默认值补齐） */
	settings: ExtensionSettings;
	/** 语言项：与实际显示语言一起随配置备份 */
	locale: LocaleOption;
	/** 云端文件写入时间（毫秒）；0 = 文件未带可用时间戳 */
	updatedAt: number;
}

/** 云盘连接参数（地址/账号/密码/开关）不属于可备份配置，见 serializeCloudSettings 注释 */
function withoutConnection(settings: ExtensionSettings): ExtensionSettings {
	return {
		...settings,
		webdavUrl: "",
		webdavUser: "",
		webdavPass: "",
		webdavEnabled: false,
	};
}

/**
 * 序列化为云端文件内容：{ version, updatedAt, locale, settings }。
 *
 * 云盘连接参数（地址、账号、密码、开关）一律不外传：
 * 1. 它是"引导凭据"—— 重装后必须由用户重新填写才能读到这份文件，存进去也无用；
 * 2. 文件本身受同一组凭据保护，把密码写进文件等于让目录分享/泄露时连账号一起丢。
 * 其余配置（平台、正则、各类 API Key、音量、排除站点等）全部备份。
 */
export function serializeCloudSettings(
	settings: ExtensionSettings,
	locale: LocaleOption,
	updatedAt: number = Date.now(),
): string {
	return JSON.stringify({
		version: CLOUD_SETTINGS_VERSION,
		updatedAt,
		locale,
		settings: withoutConnection(settings),
	});
}

/**
 * 解析云端文件内容。非对象、缺少 settings 对象一律返回 null（视为云端无配置）。
 * settings 内部字段走 normalizeSettings 校验，坏字段回落默认值而不是整份丢弃。
 */
export function parseCloudSettings(data: unknown): CloudSettings | null {
	if (!data || typeof data !== "object") return null;
	const container = data as {
		settings?: unknown;
		locale?: unknown;
		updatedAt?: unknown;
	};
	const rawSettings = container.settings;
	if (!rawSettings || typeof rawSettings !== "object") return null;
	const locale: LocaleOption =
		container.locale === "zh-hans" ||
		container.locale === "zh-hant" ||
		container.locale === "en"
			? container.locale
			: "auto";
	const updatedAt =
		typeof container.updatedAt === "number" &&
		Number.isFinite(container.updatedAt) &&
		container.updatedAt > 0
			? container.updatedAt
			: 0;
	return { settings: normalizeSettings(rawSettings), locale, updatedAt };
}

/**
 * 本地配置是否仍是"出厂状态"（与默认配置逐字段一致）。
 * 云盘连接参数不参与比较：重装后用户必然是先填地址与账号再打开开关，
 * 若把它算进来，"恢复"场景会被永远误判成"本地已有自定义配置"。
 */
export function isPristineSettings(settings: ExtensionSettings): boolean {
	return (
		configSignature(withoutConnection(settings)) ===
		configSignature(DEFAULT_SETTINGS)
	);
}

export type CloudSettingsAction = "push" | "pull" | "conflict";

/**
 * 打开云盘开关后的动作判定：
 * - 云端无配置 → 把本地推上去（首次备份）；
 * - 云端有配置且本地仍是出厂状态 → 直接恢复（重装/换设备场景，无需打扰用户）；
 * - 云端有配置且本地已自定义 → 交给用户选，绝不静默覆盖任何一侧。
 */
export function decideCloudSettingsAction(
	cloud: CloudSettings | null,
	local: ExtensionSettings,
): CloudSettingsAction {
	if (!cloud) return "push";
	return isPristineSettings(local) ? "pull" : "conflict";
}

export interface WebdavConnection {
	url: string;
	user: string;
	pass: string;
}

/**
 * 恢复时的合并口径：云端配置覆盖本地，但云盘连接参数沿用表单里刚验证通过的值
 * （云端旧地址/账号会把刚打通的连接改坏，而这三个参数本来就不在备份范围内）。
 */
export function mergeCloudSettings(
	cloud: CloudSettings,
	connection: WebdavConnection,
): ExtensionSettings {
	return {
		...cloud.settings,
		webdavUrl: connection.url,
		webdavUser: connection.user,
		webdavPass: connection.pass,
		webdavEnabled: true,
	};
}
