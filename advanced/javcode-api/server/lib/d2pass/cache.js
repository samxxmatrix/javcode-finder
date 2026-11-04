/**
 * D2Pass 分支的缓存/限流业务封装。
 *
 * 字符串级读写交给 shared/cache.js 的统一底座（Redis 单例 + 进程内降级），
 * 本层只负责键前缀、JSON 序列化与限流窗口语义 —— 不在本文件重复建连或维护 Map。
 */

import {
	cacheGetRaw,
	cacheSetRaw,
	cacheGetManyRaw,
	cacheIncrWithExpiry,
	cacheBackend as sharedCacheBackend,
} from '../../shared/cache.js';

const positiveKey = (code) => `D2P:${code}`;
const negativeKey = (code) => `D2P:NF:${code}`;

/** 坏数据/损坏条目按未命中处理，避免一个脏键让整条查询 500。 */
function parseRaw(raw) {
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export async function cacheGet(code) {
	return parseRaw(await cacheGetRaw(positiveKey(code)));
}

export async function cacheGetMany(codes) {
	const out = new Map();
	if (codes.length === 0) return out;
	const values = await cacheGetManyRaw(codes.map(positiveKey));
	codes.forEach((code, i) => {
		const parsed = parseRaw(values[i]);
		if (parsed) out.set(code, parsed);
	});
	return out;
}

/** 正结果永久写入（ttlSeconds 传 0/undefined 即不设过期）：作品信息基本不变，冷启动成本只付一次。 */
export async function cacheSet(code, value, ttlSeconds = 0) {
	await cacheSetRaw(positiveKey(code), JSON.stringify(value), ttlSeconds);
}

export async function cacheIsNegative(code) {
	return (await cacheGetRaw(negativeKey(code))) !== null;
}

/** 一次偶发失败不该把番号永久判死，故负结果必须带过期；0 表示不缓存、每次重试。 */
export async function cacheSetNegative(code, ttlSeconds) {
	if (!ttlSeconds || ttlSeconds <= 0) return;
	await cacheSetRaw(negativeKey(code), '1', Math.round(ttlSeconds));
}

/** 固定窗口限流：返回 { allowed, remaining }；窗口键自带分钟桶，整批只计 1 次由调用方保证。 */
export async function rateLimit(identity, limitPerMinute) {
	if (!limitPerMinute || limitPerMinute <= 0) return { allowed: true, remaining: Infinity };
	const bucket = Math.floor(Date.now() / 60000);
	const count = await cacheIncrWithExpiry(`D2P:RL:${identity}:${bucket}`, 60);
	return { allowed: count <= limitPerMinute, remaining: Math.max(0, limitPerMinute - count) };
}

/** 当前缓存后端，直接转发共享底座，供 debug 输出。 */
export function cacheBackend() {
	return sharedCacheBackend();
}
