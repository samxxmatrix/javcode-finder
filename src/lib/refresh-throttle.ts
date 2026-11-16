/**
 * 「重新加载预览」的防连点节流。
 *
 * 起因：`refresh=1` 会让服务端跳过永久缓存、重走完整上游链路（搜索 + 详情页 +
 * 最多 12 s 的预览探测预算），并覆盖共享缓存。用户连点番号时若每次都放行，
 * 既白打源站、又把卡片拖成连续转圈 —— 而第二次点击的期望本来就是"快点给我看"。
 *
 * 纪律：
 * - **只约束 refresh**：窗口内的重复点击降级为普通请求，命中刚写入的缓存，依然很快；
 *   直接拦截整个解析会让第二下彻底没反应，比降级更难理解。
 * - **归一化 key**：`abp-123` 与 `ABP-123` 是同一个番号，不能各放行一次。
 * - **仅内存 + FIFO 上限**：MV3 service worker 休眠重启后清空，属可接受降级。
 */

/** 同一番号的 refresh 最短间隔：5 秒足够挡住连点，又不影响"确实想再试一次" */
export const REFRESH_THROTTLE_MS = 5000;
/** 上限 200 条，与 FALENO 会话负缓存同量级，防长时间会话无限增长 */
export const REFRESH_THROTTLE_LIMIT = 200;

export interface RefreshThrottleStore {
	/** 是否允许本次 refresh；允许时登记时间戳，拒绝时不动原记录 */
	allow(code: string): boolean;
	/** 当前记录条数（供测试与诊断） */
	size(): number;
}

export function createRefreshThrottle(
	ttlMs: number = REFRESH_THROTTLE_MS,
	limit: number = REFRESH_THROTTLE_LIMIT,
	now: () => number = () => Date.now(),
): RefreshThrottleStore {
	const lastAt = new Map<string, number>();
	return {
		allow(code) {
			const key = code.trim().toUpperCase();
			const at = lastAt.get(key);
			const current = now();
			if (at !== undefined && current - at < ttlMs) return false;
			// 先删再插：Map 保插入序，复写等同于"刷新为最新"，淘汰时不会误杀刚放行的这条
			lastAt.delete(key);
			lastAt.set(key, current);
			while (lastAt.size > limit) {
				const oldest = lastAt.keys().next().value;
				if (oldest === undefined) break;
				lastAt.delete(oldest);
			}
			return true;
		},
		size: () => lastAt.size,
	};
}
