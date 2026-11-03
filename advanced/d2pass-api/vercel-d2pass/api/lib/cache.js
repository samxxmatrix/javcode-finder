/**
 * 缓存与限流。
 *
 * 策略（见 docs/d2pass-api接口文档.md 第 7 节）：
 * - 正结果 **永久保存**（不设 TTL）——作品信息基本不变，冷启动成本只付一次；
 * - 负结果（"没查到"）默认 6 小时后过期 —— 一次偶发失败（限流/地域拦截/源站抖动）不该把番号永久判死；
 * - Redis 不可用时自动退化为进程内 Map，接口仍可用（只是每个实例各存一份）。
 */

const memory = new Map(); // key -> { value, expiresAt|null }

let clientPromise = null;
let redisBroken = false;

async function getClient() {
	if (!process.env.REDIS_URL || redisBroken) return null;
	if (!clientPromise) {
		clientPromise = (async () => {
			const mod = await import("redis");
			const client = mod.createClient({ url: process.env.REDIS_URL });
			client.on("error", (err) => {
				console.error("[cache] redis error:", err?.message || err);
			});
			await client.connect();
			return client;
		})().catch((err) => {
			console.error("[cache] redis unavailable, falling back to memory:", err?.message || err);
			redisBroken = true;
			return null;
		});
	}
	return clientPromise;
}

function memGet(key) {
	const hit = memory.get(key);
	if (!hit) return null;
	if (hit.expiresAt && hit.expiresAt < Date.now()) {
		memory.delete(key);
		return null;
	}
	return hit.value;
}

function memSet(key, value, ttlSeconds) {
	memory.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
}

const positiveKey = (code) => `D2P:${code}`;
const negativeKey = (code) => `D2P:NF:${code}`;

export async function cacheGet(code) {
	const key = positiveKey(code);
	try {
		const client = await getClient();
		if (client) {
			const raw = await client.get(key);
			return raw ? JSON.parse(raw) : null;
		}
	} catch (err) {
		console.error("[cache] get failed:", err?.message || err);
	}
	const raw = memGet(key);
	return raw ? JSON.parse(raw) : null;
}

export async function cacheGetMany(codes) {
	const out = new Map();
	if (codes.length === 0) return out;
	try {
		const client = await getClient();
		if (client) {
			const values = await client.mGet(codes.map(positiveKey));
			codes.forEach((code, i) => {
				if (values[i]) out.set(code, JSON.parse(values[i]));
			});
			return out;
		}
	} catch (err) {
		console.error("[cache] mget failed:", err?.message || err);
	}
	for (const code of codes) {
		const raw = memGet(positiveKey(code));
		if (raw) out.set(code, JSON.parse(raw));
	}
	return out;
}

/** 正结果永久写入（ttlSeconds 传 0/undefined 即不设过期） */
export async function cacheSet(code, value, ttlSeconds = 0) {
	const key = positiveKey(code);
	const raw = JSON.stringify(value);
	try {
		const client = await getClient();
		if (client) {
			if (ttlSeconds > 0) await client.set(key, raw, { EX: ttlSeconds });
			else await client.set(key, raw);
			return;
		}
	} catch (err) {
		console.error("[cache] set failed:", err?.message || err);
	}
	memSet(key, raw, ttlSeconds);
}

export async function cacheIsNegative(code) {
	const key = negativeKey(code);
	try {
		const client = await getClient();
		if (client) return Boolean(await client.exists(key));
	} catch (err) {
		console.error("[cache] nf exists failed:", err?.message || err);
	}
	return memGet(key) !== null;
}

export async function cacheSetNegative(code, ttlSeconds) {
	if (!ttlSeconds || ttlSeconds <= 0) return; // 0 = 不缓存负结果，每次重试
	const key = negativeKey(code);
	try {
		const client = await getClient();
		if (client) {
			await client.set(key, "1", { EX: Math.round(ttlSeconds) });
			return;
		}
	} catch (err) {
		console.error("[cache] nf set failed:", err?.message || err);
	}
	memSet(key, "1", ttlSeconds);
}

/** 固定窗口限流：返回 { allowed, remaining } */
export async function rateLimit(identity, limitPerMinute) {
	if (!limitPerMinute || limitPerMinute <= 0) return { allowed: true, remaining: Infinity };
	const bucket = Math.floor(Date.now() / 60000);
	const key = `D2P:RL:${identity}:${bucket}`;
	try {
		const client = await getClient();
		if (client) {
			const count = await client.incr(key);
			if (count === 1) await client.expire(key, 60);
			return { allowed: count <= limitPerMinute, remaining: Math.max(0, limitPerMinute - count) };
		}
	} catch (err) {
		console.error("[cache] ratelimit failed:", err?.message || err);
	}
	const current = (memGet(key) || 0) + 1;
	memSet(key, current, 60);
	return { allowed: current <= limitPerMinute, remaining: Math.max(0, limitPerMinute - current) };
}

export function cacheBackend() {
	if (process.env.REDIS_URL && !redisBroken) return "redis";
	if (redisBroken) return "memory(redis-failed)";
	return "memory";
}

/** 诊断/测试用：进程内缓存的键数明细（返回 null 表示用的是 Redis） */
export function memoryKeyStats() {
	if (!cacheBackend().startsWith("memory")) return null;
	let positive = 0;
	let negative = 0;
	let ratelimit = 0;
	for (const key of memory.keys()) {
		if (key.startsWith("D2P:NF:")) negative++;
		else if (key.startsWith("D2P:RL:")) ratelimit++;
		else positive++;
	}
	return { total: memory.size, positive, negative, ratelimit };
}
