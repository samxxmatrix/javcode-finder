/**
 * 极简重试助手：网络层失败（超时 / 连接错误）时把同一个操作再跑一次。
 *
 * 场景：反代查询链路是 CF 入口 → 东京 Vercel，冷启动实测可达 4.4 s；
 * 首次请求本身带有"唤醒"作用，失败后立刻重试通常就能命中热路径。
 * 默认尝试 2 次（= 1 次重试）；attempts < 1 或非法值按默认处理。
 * 不引入退避延迟：重试的目的就是尽快用上已经被唤醒的热实例。
 */
export const DEFAULT_RETRY_ATTEMPTS = 2;

export interface RetryOptions {
	/** 总尝试次数（含首次），默认 2 */
	attempts?: number;
}

export async function withRetry<T>(
	operation: () => Promise<T>,
	{ attempts = DEFAULT_RETRY_ATTEMPTS }: RetryOptions = {},
): Promise<T> {
	const total = Number.isFinite(attempts)
		? Math.max(1, Math.floor(attempts))
		: DEFAULT_RETRY_ATTEMPTS;

	let lastError: unknown;
	for (let attempt = 1; attempt <= total; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError;
}
