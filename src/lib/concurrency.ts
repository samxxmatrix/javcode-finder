/**
 * 保序的并发映射：固定 `limit` 个 runner 轮流从队列取下一个下标
 * （见 docs/superpowers/specs/2026-10-10-cover-performers-release-date-design.md §4.3 / §6）。
 *
 * 用途：出演者逐名翻译需要**每个名字一次请求**（才能吃到 Worker 的 KV 缓存），
 * 但不能一次放出去几十个请求，因此限并发 4。
 *
 * 语义：
 * - 返回数组与入参**同序**；
 * - `worker` 抛错不中断其它项，该位置为 `null`（调用方按"该项失败"处理）；
 * - `limit <= 0` / 非有限数视为 1；空数组直接返回 `[]`（不启动任何 runner）。
 */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	worker: (item: T) => Promise<R>,
): Promise<(R | null)[]> {
	const results: (R | null)[] = new Array(items.length).fill(null);
	if (items.length === 0) return results;

	const size = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1;
	let next = 0;

	const runners = Array.from(
		{ length: Math.min(size, items.length) },
		async () => {
			for (;;) {
				const index = next++;
				const item = items[index];
				if (item === undefined) return;
				try {
					results[index] = await worker(item);
				} catch {
					results[index] = null;
				}
			}
		},
	);

	await Promise.all(runners);
	return results;
}
