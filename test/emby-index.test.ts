import { afterEach, describe, expect, it, vi } from "vitest";
import {
	isEmbyIndexFresh,
	needsEmbyFullSync,
	type EmbyIndex,
} from "../src/lib/emby";
import {
	EMBY_INDEX_STORAGE_KEY,
	browserEmbyStore,
	clearEmbyIndex,
	loadEmbyIndex,
	parseEmbyIndex,
	saveEmbyIndex,
	type EmbyIndexStore,
} from "../src/lib/emby-index";

const INDEX: EmbyIndex = {
	v: 1,
	serverKey: "aaa",
	regexKey: "bbb",
	syncedAt: 1_700_000_000_000,
	total: 282,
	keys: ["JUL769", "HEYZO406"],
};

function createFakeStore(): { store: EmbyIndexStore; data: Map<string, unknown> } {
	const data = new Map<string, unknown>();
	return {
		data,
		store: {
			get: async (key) => data.get(key),
			set: async (key, value) => {
				data.set(key, value);
			},
			remove: async (key) => {
				data.delete(key);
			},
		},
	};
}

describe("parseEmbyIndex", () => {
	it("接受合法索引", () => {
		expect(parseEmbyIndex(INDEX)).toEqual(INDEX);
	});

	it("拒绝版本不符、字段缺失或 keys 非数组", () => {
		expect(parseEmbyIndex(null)).toBeNull();
		expect(parseEmbyIndex({ ...INDEX, v: 2 })).toBeNull();
		expect(parseEmbyIndex({ ...INDEX, serverKey: undefined })).toBeNull();
		expect(parseEmbyIndex({ ...INDEX, syncedAt: "x" })).toBeNull();
		expect(parseEmbyIndex({ ...INDEX, keys: "x" })).toBeNull();
	});

	it("拒绝非法时间戳（NaN/负数/Infinity/非数字）", () => {
		expect(parseEmbyIndex({ ...INDEX, syncedAt: Number.NaN })).toBeNull();
		expect(parseEmbyIndex({ ...INDEX, syncedAt: -1 })).toBeNull();
		expect(
			parseEmbyIndex({ ...INDEX, syncedAt: Number.POSITIVE_INFINITY }),
		).toBeNull();
		expect(parseEmbyIndex({ ...INDEX, syncedAt: "x" })).toBeNull();
	});

	it("非法 total 归一为 0，合法 0 保持 0", () => {
		const negative = parseEmbyIndex({ ...INDEX, total: -5 });
		expect(negative).not.toBeNull();
		expect(negative?.total).toBe(0);

		const nan = parseEmbyIndex({ ...INDEX, total: Number.NaN });
		expect(nan).not.toBeNull();
		expect(nan?.total).toBe(0);

		const infinite = parseEmbyIndex({
			...INDEX,
			total: Number.POSITIVE_INFINITY,
		});
		expect(infinite).not.toBeNull();
		expect(infinite?.total).toBe(0);

		expect(parseEmbyIndex({ ...INDEX, total: 0 })?.total).toBe(0);
		expect(parseEmbyIndex({ ...INDEX, total: 282 })?.total).toBe(282);
	});

	it("过滤 keys 中的非字符串项", () => {
		const parsed = parseEmbyIndex({ ...INDEX, keys: ["A", 1, null] });
		expect(parsed?.keys).toEqual(["A"]);
	});
});

describe("loadEmbyIndex / saveEmbyIndex / clearEmbyIndex", () => {
	it("存取往返", async () => {
		const { store, data } = createFakeStore();
		await expect(saveEmbyIndex(store, INDEX)).resolves.toBe(true);
		expect(data.get(EMBY_INDEX_STORAGE_KEY)).toEqual(INDEX);
		await expect(loadEmbyIndex(store)).resolves.toEqual(INDEX);
	});

	it("无 store、读取异常、内容非法都返回 null", async () => {
		await expect(loadEmbyIndex(null)).resolves.toBeNull();
		const broken: EmbyIndexStore = {
			get: async () => {
				throw new Error("boom");
			},
			set: async () => {},
			remove: async () => {},
		};
		await expect(loadEmbyIndex(broken)).resolves.toBeNull();
		const { store, data } = createFakeStore();
		data.set(EMBY_INDEX_STORAGE_KEY, { v: 9 });
		await expect(loadEmbyIndex(store)).resolves.toBeNull();
	});

	it("写入失败返回 false", async () => {
		const failing: EmbyIndexStore = {
			get: async () => undefined,
			set: async () => {
				throw new Error("quota");
			},
			remove: async () => {},
		};
		await expect(saveEmbyIndex(failing, INDEX)).resolves.toBe(false);
		await expect(saveEmbyIndex(null, INDEX)).resolves.toBe(false);
	});

	it("清除索引", async () => {
		const { store, data } = createFakeStore();
		await saveEmbyIndex(store, INDEX);
		await clearEmbyIndex(store);
		expect(data.has(EMBY_INDEX_STORAGE_KEY)).toBe(false);
		await expect(loadEmbyIndex(store)).resolves.toBeNull();
	});

	it("remove 抛错时 clearEmbyIndex 不抛", async () => {
		const brokenRemove: EmbyIndexStore = {
			get: async () => undefined,
			set: async () => {},
			remove: async () => {
				throw new Error("boom");
			},
		};
		await expect(clearEmbyIndex(brokenRemove)).resolves.toBeUndefined();
		await expect(clearEmbyIndex(null)).resolves.toBeUndefined();
	});
});

interface MemoryLocal {
	get(key: string): Promise<Record<string, unknown>>;
	set(items: Record<string, unknown>): Promise<void>;
	remove(key: string): Promise<void>;
}

/** storage.local 的最小内存假实现：get 返回 {[key]: value}，与 chrome.storage.local 同形 */
function createMemoryLocal(): { local: MemoryLocal; data: Map<string, unknown> } {
	const data = new Map<string, unknown>();
	return {
		data,
		local: {
			get: async (key) => {
				const result: Record<string, unknown> = {};
				if (data.has(key)) result[key] = data.get(key);
				return result;
			},
			set: async (items) => {
				for (const [key, value] of Object.entries(items)) data.set(key, value);
			},
			remove: async (key) => {
				data.delete(key);
			},
		},
	};
}

describe("browserEmbyStore", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("Chrome MV3 只有 chrome 全局时也能解析到 storage.local 并完成持久化", async () => {
		const { local, data } = createMemoryLocal();
		vi.stubGlobal("chrome", { storage: { local } });

		const store = browserEmbyStore();
		expect(store).not.toBeNull();

		await expect(saveEmbyIndex(store, INDEX)).resolves.toBe(true);
		expect(data.get(EMBY_INDEX_STORAGE_KEY)).toEqual(INDEX);
		await expect(loadEmbyIndex(store)).resolves.toEqual(INDEX);

		await clearEmbyIndex(store);
		expect(data.has(EMBY_INDEX_STORAGE_KEY)).toBe(false);
		await expect(loadEmbyIndex(store)).resolves.toBeNull();
	});

	it("storage.local 缺少 get/set/remove 时返回 null", () => {
		vi.stubGlobal("chrome", { storage: { local: {} } });
		expect(browserEmbyStore()).toBeNull();
	});

	it("没有任何 browser/chrome 全局时返回 null", () => {
		expect(browserEmbyStore()).toBeNull();
	});
});

describe("空 serverKey 加固（src/lib/emby.ts）", () => {
	const emptyServerIndex: EmbyIndex = {
		...INDEX,
		serverKey: "",
		syncedAt: 1_700_000_000_000,
	};

	it("serverKey 为空时索引不算新鲜", () => {
		expect(
			isEmbyIndexFresh(emptyServerIndex, 1_700_000_000_000, "", "bbb"),
		).toBe(false);
	});

	it("serverKey 为空时需要全量重建", () => {
		expect(
			needsEmbyFullSync(emptyServerIndex, 1_700_000_000_000, "", "bbb"),
		).toBe(true);
	});
});
