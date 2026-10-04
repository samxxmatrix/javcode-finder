/**
 * 版本更新检查（纯逻辑；网络请求由 background 发）。
 *
 * 检查源是**自己发布的 Release 资产** `version.json`，而不是 GitHub API：
 * `api.github.com/releases/latest` 未认证只有 60 次/小时/IP，多用户共用出口会被挤爆。
 * `releases/latest/download/<asset>` 无配额、走 CDN、且跟随 latest 自动切换。
 *
 * 资产格式（发版脚本负责生成并随 Release 上传）：
 *   { "version": "2.1.0", "url": "https://…/javcode-finder-extension-2.1.0-chrome.zip", "notes": "可选" }
 * 缺失或非法时静默当作"没有更新"，绝不影响扩展主流程。
 */

export const LATEST_VERSION_URL =
	"https://github.com/aizhimou/javranking-extension/releases/latest/download/version.json";
export const RELEASES_PAGE_URL =
	"https://github.com/aizhimou/javranking-extension/releases/latest";

/** 检查节流：24 小时内不重复请求 */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_STATE_STORAGE_KEY = "javranking_update_state";

export interface AvailableUpdate {
	version: string;
	url: string;
	notes: string | null;
}

export interface UpdateState {
	/** 上次成功检查的时间戳；null = 从未检查过 */
	checkedAt: number | null;
	/** 上次查到的可用更新（节流期内直接复用，避免关掉面板再开就看不到提示） */
	latest: AvailableUpdate | null;
	/** 用户关掉的版本号；同一版本不再提示，出现更高版本会重新提示 */
	dismissedVersion: string | null;
}

export const EMPTY_UPDATE_STATE: UpdateState = {
	checkedAt: null,
	latest: null,
	dismissedVersion: null,
};

/**
 * 解析版本号：接受 `v` 前缀与 1-4 段整数，短的补 0 到三段。
 * 带预发布后缀（`2.1.0-beta`）或超过 4 段一律视为非法 —— Chrome manifest 的
 * version 只允许 1-4 段整数，非法输入宁可当作"没有更新"。
 */
export function parseVersion(version: string): number[] | null {
	const match = version
		.trim()
		.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?$/i);
	if (!match) return null;
	const major = Number(match[1]);
	const minor = match[2] === undefined ? 0 : Number(match[2]);
	const patch = match[3] === undefined ? 0 : Number(match[3]);
	return match[4] === undefined
		? [major, minor, patch]
		: [major, minor, patch, Number(match[4])];
}

/** 候选版本是否比当前版本新。必须逐段数值比较（字符串比较会把 2.10.0 判成小于 2.9.9） */
export function isNewerVersion(candidate: string, current: string): boolean {
	const next = parseVersion(candidate);
	const installed = parseVersion(current);
	if (!next || !installed) return false;

	const length = Math.max(next.length, installed.length);
	for (let index = 0; index < length; index += 1) {
		const a = next[index] ?? 0;
		const b = installed[index] ?? 0;
		if (a !== b) return a > b;
	}
	return false;
}

/** 校验 `version.json` 资产；version 非法即 null，url 非法/缺失退回 Release 页 */
export function parseReleaseManifest(data: unknown): AvailableUpdate | null {
	if (typeof data !== "object" || data === null) return null;
	const raw = data as Record<string, unknown>;
	if (typeof raw.version !== "string") return null;
	const parsed = parseVersion(raw.version);
	if (!parsed) return null;

	return {
		version: parsed.join("."),
		url:
			typeof raw.url === "string" && raw.url.startsWith("https://")
				? raw.url
				: RELEASES_PAGE_URL,
		notes:
			typeof raw.notes === "string" && raw.notes.trim()
				? raw.notes.trim()
				: null,
	};
}

export function parseUpdateState(raw: string | null): UpdateState {
	if (!raw) return { ...EMPTY_UPDATE_STATE };
	try {
		const data = JSON.parse(raw) as unknown;
		if (typeof data !== "object" || data === null) {
			return { ...EMPTY_UPDATE_STATE };
		}
		const record = data as Record<string, unknown>;
		return {
			checkedAt:
				typeof record.checkedAt === "number" &&
				Number.isFinite(record.checkedAt)
					? record.checkedAt
					: null,
			latest: parseReleaseManifest(record.latest),
			dismissedVersion:
				typeof record.dismissedVersion === "string" &&
				record.dismissedVersion
					? record.dismissedVersion
					: null,
		};
	} catch {
		return { ...EMPTY_UPDATE_STATE };
	}
}

export function serializeUpdateState(state: UpdateState): string {
	return JSON.stringify(state);
}

export function readUpdateState(storage: Storage | null): UpdateState {
	if (!storage) return { ...EMPTY_UPDATE_STATE };
	try {
		return parseUpdateState(storage.getItem(UPDATE_STATE_STORAGE_KEY));
	} catch {
		return { ...EMPTY_UPDATE_STATE };
	}
}

export function writeUpdateState(
	storage: Storage | null,
	state: UpdateState,
): void {
	if (!storage) return;
	try {
		storage.setItem(UPDATE_STATE_STORAGE_KEY, serializeUpdateState(state));
	} catch {
		// 写入失败（配额/隐私模式）不影响主流程
	}
}

/** 是否到了该检查的时间（24h 节流） */
export function shouldCheckForUpdate(
	state: UpdateState,
	now: number,
	intervalMs: number = UPDATE_CHECK_INTERVAL_MS,
): boolean {
	if (state.checkedAt === null) return true;
	return now - state.checkedAt >= intervalMs;
}

/** 是否该把提示显示出来（有可用更新且用户没关掉这个版本） */
export function shouldShowUpdate(state: UpdateState): boolean {
	if (!state.latest) return false;
	return state.latest.version !== state.dismissedVersion;
}
