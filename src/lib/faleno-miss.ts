/**
 * FALENO 会话级负缓存。
 *
 * 起因：`/faleno/` 反代与直连 `faleno.jp` 在 404 / 「ページが見つかりませんでした」时
 * 都不写任何缓存（服务端口径也是"不做负缓存"），于是"官网没有、DMM 有"的号**每次加载都会重问一次**，
 * 白付一次 RTT。这里用会话内存集合消掉它：命中即 0 网络请求，直接让 DMM 补查接管。
 *
 * 三条纪律：
 * - **只记确认查无**（404 / ITEM_NOT_FOUND / 解析不到作品页）；抛错不记 —— 故障不代表站点没有该号。
 * - **仅内存、不落 storage**：站点上架新作品后下次会话自然重试，避免长期假阴性；
 *   MV3 service worker 休眠重启后集合清空，属可接受降级（代价只是重新试一次）。
 * - **上限 FIFO 淘汰**：`Set` 保插入序，超限就删最旧的一条，防长时间会话无限增长。
 */
export const FALENO_MISS_LIMIT = 200;

export interface FalenoMissStore {
	/** 该番号上一轮是否已确认查无 */
	has(code: string): boolean;
	/** 记下"确认查无"；同步做 FIFO 淘汰 */
	mark(code: string): void;
	/** 当前记录条数（供测试与诊断） */
	size(): number;
}

export function createFalenoMissStore(
	limit: number = FALENO_MISS_LIMIT,
): FalenoMissStore {
	const misses = new Set<string>();
	return {
		has: (code) => misses.has(code),
		mark: (code) => {
			// 重复标记已在集合里的番号：Set.add 幂等，不应触发淘汰
			if (!misses.has(code) && misses.size >= limit) {
				const oldest = misses.values().next().value;
				if (oldest !== undefined) misses.delete(oldest);
			}
			misses.add(code);
		},
		size: () => misses.size,
	};
}
