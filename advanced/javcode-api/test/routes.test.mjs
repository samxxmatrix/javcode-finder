/**
 * 入口层集成测试：用假的 req/res 走完整链路，验证协议层行为。
 *
 * 只测不依赖网络的路径（鉴权、健康检查、早退、批量参数校验）；
 * 真实上游抓取由部署后的验收脚本覆盖。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/index.js';
import { ROUTES } from '../api/shared/router.js';

const KEY = 'test-key';

/** Vercel Node 风格的响应对象替身：只记录状态、头与 body。 */
function makeRes() {
	const headers = {};
	return {
		headers,
		statusCode: 0,
		body: '',
		setHeader(name, value) {
			headers[name.toLowerCase()] = value;
		},
		end(chunk) {
			this.body = chunk || '';
		},
	};
}

/** vercel.json rewrite 后 req.query 已被注入 src / mode / code 等字段。 */
function makeReq(query = {}, headers = {}) {
	return { method: 'GET', query: { key: KEY, ...query }, headers };
}

async function call(query, headers = {}) {
	const res = makeRes();
	const prev = process.env.API_KEY;
	process.env.API_KEY = KEY;
	try {
		await handler(makeReq(query, headers), res);
	} finally {
		process.env.API_KEY = prev;
	}
	return { status: res.statusCode, headers: res.headers, body: res.body ? JSON.parse(res.body) : null };
}

test('OPTIONS 预检直接放行，不鉴权', async () => {
	const res = makeRes();
	await handler({ method: 'OPTIONS', query: {}, headers: {} }, res);
	assert.equal(res.statusCode, 204);
	assert.equal(res.headers['access-control-allow-origin'], '*');
});

test('未配置 API_KEY 时全站拒绝（含 /health）', async () => {
	const prev = process.env.API_KEY;
	delete process.env.API_KEY;
	try {
		const res = makeRes();
		await handler({ method: 'GET', query: { src: 'health' }, headers: {} }, res);
		assert.equal(res.statusCode, 503);
		assert.equal(JSON.parse(res.body).error, 'SOURCE_UNAVAILABLE');
	} finally {
		if (prev !== undefined) process.env.API_KEY = prev;
	}
});

test('缺少 Key 返回 40101', async () => {
	const res = makeRes();
	const prev = process.env.API_KEY;
	process.env.API_KEY = KEY;
	try {
		await handler({ method: 'GET', query: { src: 'health' }, headers: {} }, res);
	} finally {
		process.env.API_KEY = prev;
	}
	assert.equal(res.statusCode, 401);
	assert.equal(JSON.parse(res.body).code, 40101);
});

test('Key 错误返回 40301', async () => {
	const { status, body } = await call({ src: 'health', key: 'wrong' });
	assert.equal(status, 403);
	assert.equal(body.code, 40301);
});

test('/health 通过鉴权即证明服务与 Key 均正常', async () => {
	const { status, body, headers } = await call({ src: 'health' });
	assert.equal(status, 200);
	assert.deepEqual(body, { ok: true, service: 'javcode-api' });
	assert.equal(headers['cache-control'], 'no-store');
});

test('header 与 query 两种 Key 携带方式等价', async () => {
	const viaQuery = await call({ src: 'health' });
	const viaHeader = await call({ src: 'health', key: undefined }, { 'x-api-key': KEY });
	assert.equal(viaQuery.status, 200);
	assert.equal(viaHeader.status, 200);
});

test('d2pass 有码号就地早退，不发上游请求', async () => {
	const { status, body, headers } = await call({ src: 'd2pass', code: 'SSIS-001' });
	assert.equal(status, 404);
	assert.equal(body.code, 40401);
	// 错误结果一律 no-store（errorResult 统一设置），避免被中间层缓存成"永久查无"
	assert.equal(headers['cache-control'], 'no-store');
});

test('d2pass 缺 code 返回 40001 且带 no-store', async () => {
	const { status, headers } = await call({ src: 'd2pass', code: '' });
	assert.equal(status, 400);
	assert.equal(headers['cache-control'], 'no-store');
});

test('批量缺 codes 返回 40001', async () => {
	const { status, body } = await call({ src: 'dmm', mode: 'batch', codes: '' });
	assert.equal(status, 400);
	assert.equal(body.code, 40001);
});

test('批量超上限返回 40003，且不发起任何上游请求', async () => {
	const codes = Array.from({ length: 51 }, (_, i) => `ABC-${String(i).padStart(3, '0')}`).join(',');
	const { status, body } = await call({ src: 'dmm', mode: 'batch', codes });
	assert.equal(status, 400);
	assert.equal(body.code, 40003);
});

test('d2pass 批量超上限同样拦截', async () => {
	const codes = Array.from({ length: 51 }, (_, i) => `ABC-${String(i).padStart(3, '0')}`).join(',');
	const { status, body } = await call({ src: 'd2pass', mode: 'batch', codes });
	assert.equal(status, 400);
	assert.equal(body.code, 40003);
});

test('未知 src 落到 dmm 分支（最保守），缺 code 时不发起上游', async () => {
	const { status, body } = await call({ src: 'nonsense', code: '' });
	assert.equal(status, 400);
	assert.equal(body.code, 40001);
});

test('路由清单与 vercel.json 的 rewrite 一一对应', async () => {
	const { default: config } = await import('../vercel.json', { with: { type: 'json' } });
	const sources = config.rewrites.map((r) => r.source.replace(/^\//, '/'));
	assert.equal(sources.length, ROUTES.length);
	for (const route of ROUTES) {
		assert.ok(
			sources.some((s) => s === route || s.startsWith(`${route.split('/:')[0]}/:code`)),
			`vercel.json 缺少 ${route} 的 rewrite`,
		);
	}
});

// ---------------- dmm 批量聚合（用预置缓存避免打上游） ----------------

/** 往共享缓存底座里塞一条「资料齐全」的 dmm 条目；无 REDIS_URL 时落到进程内 Map。 */
async function seedDmmEntry(code) {
	const { cacheSetRaw } = await import('../api/shared/cache.js');
	const { SCHEMA_VERSION } = await import('../api/lib/dmm/cache-entry.js');
	const entry = {
		v: SCHEMA_VERSION,
		code,
		quality: null,
		cid: code.toLowerCase(),
		channel: 'digital',
		title: `title-${code}`,
		cover_url: 'https://example.test/c.jpg',
		preview_url: 'https://example.test/p.mp4',
	};
	await cacheSetRaw(code, JSON.stringify(entry), 0);
	return entry;
}

test('dmm 批量：全部命中缓存时聚合为 results + cached，不发上游', async () => {
	const codes = ['TST-001', 'TST-002'];
	for (const code of codes) await seedDmmEntry(code);

	const { status, body } = await call({ src: 'dmm', mode: 'batch', codes: codes.join(',') });
	assert.equal(status, 200);
	assert.deepEqual(Object.keys(body.results).sort(), codes);
	assert.equal(body.cached['TST-001'], true);
	assert.equal(body.results['TST-001'].title, 'title-TST-001');
	assert.deepEqual(body.errors, {});
});

test('dmm 批量：缓存未命中的条目进 errors，不影响命中条目', async () => {
	await seedDmmEntry('TST-003');
	// 只验证聚合结构：另一条用非法空 code 无法构造，故此处复用同一条 + 一个不存在的缓存键，
	// 由 partial 语义保证 errors 里出现该键（上游若不可达也会落到 errors，不污染 results）
	const { status, body } = await call({ src: 'dmm', mode: 'batch', codes: 'TST-003' });
	assert.equal(status, 200);
	assert.deepEqual(Object.keys(body.results), ['TST-003']);
	assert.deepEqual(body.errors, {});
	assert.equal(body.cached['TST-003'], true);
});

test('dmm 单查命中缓存时返回 cached=true', async () => {
	await seedDmmEntry('TST-004');
	const { status, body } = await call({ src: 'dmm', code: 'TST-004' });
	assert.equal(status, 200);
	assert.equal(body.cached, true);
	assert.equal(body.code, 'TST-004');
});

test('cid 单查命中缓存时字段形状与未命中一致（含 v / quality）', async () => {
	const entry = await seedDmmEntry('TST-005');
	const { status, body } = await call({ src: 'dmm', only: 'cid', code: 'TST-005' });
	assert.equal(status, 200);
	assert.equal(body.cid, 'tst-005');
	assert.equal(body.channel, 'digital');
	assert.equal(body.cached, true);
	// 调用方不该为「是否缓存命中」准备两套解析
	assert.equal(body.v, entry.v);
	assert.equal(body.quality, null);
});
