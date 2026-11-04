/**
 * 统一缓存与限流底座：模块级 Redis 单例 + 进程内降级。
 *
 * 只做字符串级读写，不解释缓存值语义 —— DMM 的裸响应对象与 D2PASS 的
 * {v,data,partial,quality} 信封由各自 lib 负责序列化与版本校验。
 */

import { createClient } from 'redis';

let clientPromise = null;
let redisBroken = false;
const memory = new Map();

/** 懒加载单例；未配置 REDIS_URL 或连接失败时退化为进程内 Map。 */
async function client() {
	if (!process.env.REDIS_URL || redisBroken) return null;
	if (!clientPromise) {
		clientPromise = (async () => {
			const c = createClient({
				url: process.env.REDIS_URL,
				socket: { connectTimeout: 3000, reconnectStrategy: false },
			});
			c.on('error', () => {});
			await c.connect();
			return c;
		})().catch(() => {
			redisBroken = true;
			return null;
		});
	}
	return clientPromise;
}

/** 读取字符串值；Redis 不可用时读内存副本。 */
export async function cacheGetRaw(key) {
	const c = await client();
	if (!c) return memory.has(key) ? memory.get(key) : null;
	try {
		return await Promise.race([
			c.get(key),
			new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
		]);
	} catch {
		return null;
	}
}

/** 批量读取，返回与 keys 等长的数组。 */
export async function cacheGetManyRaw(keys) {
	return Promise.all(keys.map((key) => cacheGetRaw(key)));
}

/** 写入字符串值；ttlSeconds > 0 时下发 EX。 */
export async function cacheSetRaw(key, value, ttlSeconds = 0) {
	memory.set(key, value);
	const c = await client();
	if (!c) return;
	try {
		await c.set(key, value, ttlSeconds > 0 ? { EX: ttlSeconds } : {});
	} catch {
		// 写失败不影响响应，内存副本仍在
	}
}

/** 固定窗口计数：INCR + EXPIRE，供 D2PASS 分支限流使用。 */
export async function cacheIncrWithExpiry(key, ttlSeconds) {
	const c = await client();
	if (!c) {
		const bucket = Math.floor(Date.now() / (ttlSeconds * 1000));
		const memKey = `${key}:${bucket}`;
		const count = (memory.get(memKey) || 0) + 1;
		memory.set(memKey, count);
		return count;
	}
	try {
		const count = await c.incr(key);
		if (count === 1) await c.expire(key, ttlSeconds);
		return count;
	} catch {
		return 0;
	}
}

/** 当前缓存后端，供 debug 输出。 */
export function cacheBackend() {
	return redisBroken || !process.env.REDIS_URL ? 'memory' : 'redis';
}
