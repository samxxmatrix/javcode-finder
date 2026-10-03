/**
 * Emby 索引的持久化层。
 * 必须用 browser.storage.local（不是 localStorage）：MV3 的 background service worker
 * 没有 localStorage，而索引由 background 写入、面板读取。
 * 存储层通过 EmbyIndexStore 注入，单测可传假实现。
 */
import type { EmbyIndex } from "./emby";

export const EMBY_INDEX_STORAGE_KEY = "javranking_emby_index_v1";

export interface EmbyIndexStore {
	get(key: string): Promise<unknown>;
	set(key: string, value: unknown): Promise<void>;
	remove(key: string): Promise<void>;
}

/** 校验并归一化存储内容；结构非法返回 null（调用方视为无索引） */
export function parseEmbyIndex(raw: unknown): EmbyIndex | null {
	if (!raw || typeof raw !== "object") return null;
	const candidate = raw as Partial<EmbyIndex>;
	if (candidate.v !== 1) return null;
	if (typeof candidate.serverKey !== "string") return null;
	if (typeof candidate.regexKey !== "string") return null;
	if (
		typeof candidate.syncedAt !== "number" ||
		!Number.isFinite(candidate.syncedAt) ||
		candidate.syncedAt < 0
	) {
		return null;
	}
	if (!Array.isArray(candidate.keys)) return null;
	return {
		v: 1,
		serverKey: candidate.serverKey,
		regexKey: candidate.regexKey,
		syncedAt: candidate.syncedAt,
		total:
			typeof candidate.total === "number" &&
			Number.isFinite(candidate.total) &&
			candidate.total >= 0
				? candidate.total
				: 0,
		keys: candidate.keys.filter((key): key is string => typeof key === "string"),
	};
}

export async function loadEmbyIndex(
	store: EmbyIndexStore | null,
): Promise<EmbyIndex | null> {
	if (!store) return null;
	try {
		return parseEmbyIndex(await store.get(EMBY_INDEX_STORAGE_KEY));
	} catch {
		return null;
	}
}

export async function saveEmbyIndex(
	store: EmbyIndexStore | null,
	index: EmbyIndex,
): Promise<boolean> {
	if (!store) return false;
	try {
		await store.set(EMBY_INDEX_STORAGE_KEY, index);
		return true;
	} catch {
		return false;
	}
}

export async function clearEmbyIndex(store: EmbyIndexStore | null): Promise<void> {
	if (!store) return;
	try {
		await store.remove(EMBY_INDEX_STORAGE_KEY);
	} catch {
		// 清除失败不影响后续流程
	}
}

interface BrowserLocalStorage {
	get(key: string): Promise<Record<string, unknown>>;
	set(items: Record<string, unknown>): Promise<void>;
	remove(key: string): Promise<void>;
}

/**
 * 把运行时的 browser.storage.local 适配成 EmbyIndexStore。
 * 未声明 "storage" 权限或环境不支持时返回 null（调用方降级为"不显示图标"）。
 */
export function browserEmbyStore(): EmbyIndexStore | null {
	const local = (
		globalThis as {
			browser?: { storage?: { local?: BrowserLocalStorage } };
		}
	).browser?.storage?.local;
	if (!local) return null;
	return {
		get: async (key) => (await local.get(key))?.[key],
		set: async (key, value) => {
			await local.set({ [key]: value });
		},
		remove: async (key) => {
			await local.remove(key);
		},
	};
}
