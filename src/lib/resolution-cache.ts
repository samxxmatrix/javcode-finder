/**
 * 番号解析结果的内存缓存。
 *
 * 起因：`resolveCurrentCode` 每次换号都清 src、重置状态、重新 `jt:resolve-detail`，
 * `resolve-preview.ts` 里 DMM 与 JavTrailers 是并行不是复用 —— 于是列表里 A→B→A 往返时，
 * A 要重新解析 + 重新下封面 + 重新预取，体感就是"回看比第一次还慢"。
 *
 * 三条纪律：
 * - **只缓存 resolved**：空结果与失败一律不写 —— 故障缓存 3 分钟会让用户重试也无效。
 * - **仅内存、不落 storage**：`previewUrl` 是带时效签名的临时地址，持久化只会让下次启动
 *   拿着过期地址去播。MV3 service worker 休眠重启后清空，属可接受降级。
 * - **短 TTL + 上限 FIFO**：3 分钟足够覆盖"A→B→A"的回看节奏，又不会久到签名失效；
 *   上限 50 条防长时间会话无限增长。
 */
export const RESOLUTION_CACHE_LIMIT = 50;
/** 3 分钟：覆盖来回比对的节奏，同时把命中到过期签名地址的概率压到很低 */
export const RESOLUTION_CACHE_TTL_MS = 3 * 60 * 1000;

export interface ResolutionCacheStore<T> {
	/** 命中且未过期才返回；过期条目顺手删掉 */
	get(key: string): T | null;
	set(key: string, value: T): void;
	clear(): void;
	/** 当前条数（供测试与诊断） */
	size(): number;
}

export function createResolutionCacheStore<T>(
	ttlMs: number = RESOLUTION_CACHE_TTL_MS,
	limit: number = RESOLUTION_CACHE_LIMIT,
	now: () => number = () => Date.now(),
): ResolutionCacheStore<T> {
	const entries = new Map<string, { at: number; value: T }>();
	return {
		get(key) {
			const hit = entries.get(key);
			if (!hit) return null;
			if (now() - hit.at > ttlMs) {
				entries.delete(key);
				return null;
			}
			return hit.value;
		},
		set(key, value) {
			// 先删再插：Map 保插入序，复写等同于"刷新为最新"，淘汰时不会误杀掉刚写的这条
			entries.delete(key);
			entries.set(key, { at: now(), value });
			while (entries.size > limit) {
				const oldest = entries.keys().next().value;
				if (oldest === undefined) break;
				entries.delete(oldest);
			}
		},
		clear() {
			entries.clear();
		},
		size() {
			return entries.size;
		},
	};
}

/** 会影响解析结果的设置摘要 */
export interface ResolutionCacheScope {
	/** 番号查询开关：关掉就不走反代，结果可能完全不同 */
	lookupEnabled: boolean;
	/** FALENO 前缀：决定第二路是 FNS 分支还是 DMM 分支 */
	falenoPrefixes: string[];
	/** 反代地址：决定是否走反代出口、走哪个出口 */
	apiBase: string;
}

/**
 * 缓存 key：番号 + 影响结果的设置摘要。
 *
 * 为什么必须带设置：改了 `falenoPrefixes` 或反代地址后，同一个番号的解析路数会变，
 * 若只用番号做 key，改完设置回来还会命中旧结果，看起来就像"设置没生效"。
 * 反代 Key 不计入 —— 它只影响鉴权，不影响数据源；鉴权失败本身不会写出缓存。
 */
export function buildResolutionCacheKey(
	code: string,
	scope: ResolutionCacheScope,
): string {
	return [
		code.trim().toUpperCase(),
		scope.lookupEnabled ? "1" : "0",
		hashScopePart(scope.falenoPrefixes.join(",")),
		hashScopePart(scope.apiBase.trim()),
	].join("|");
}

/** djb2：把长字符串压成短标记，只为拼 key，不用于安全场景 */
function hashScopePart(input: string): string {
	let hash = 5381;
	for (let i = 0; i < input.length; i += 1) {
		hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
	}
	return (hash >>> 0).toString(36);
}
