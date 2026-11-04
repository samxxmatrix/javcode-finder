import test from 'node:test';
import assert from 'node:assert/strict';

import { ROUTES, resolveSource, isBatch, normalizeQuery } from '../server/shared/router.js';
import { errorResult, okResult } from '../server/shared/errors.js';
import { sendResult, sendOptions, CORS_HEADERS } from '../server/shared/respond.js';
import { checkApiKey } from '../server/shared/auth.js';
import { parseQualityHeight, readConfig } from '../server/shared/config.js';

/** 最小响应对象，只实现入口层用到的三个方法。 */
function mockRes() {
	const headers = {};
	return {
		headers,
		statusCode: null,
		body: null,
		setHeader(name, value) { headers[name] = value; },
		end(text) { this.body = text; },
	};
}

test('对外路由清单恰好七条，且批量路径排在单查通配之前', () => {
	assert.equal(ROUTES.length, 7);
	assert.ok(ROUTES.indexOf('/dmm/batch') < ROUTES.indexOf('/dmm/:code'));
	assert.ok(ROUTES.indexOf('/d2pass/batch') < ROUTES.indexOf('/d2pass/:code'));
	assert.ok(ROUTES.includes('/health'));
});

test('resolveSource 只认显式 src，缺失或未知回落到 dmm', () => {
	assert.equal(resolveSource({ query: { src: 'd2pass' } }), 'd2pass');
	assert.equal(resolveSource({ query: { src: 'health' } }), 'health');
	assert.equal(resolveSource({ query: {} }), 'dmm');
	assert.equal(resolveSource({ query: { src: 'unknown' } }), 'dmm');
});

test('isBatch 只认 rewrite 注入的 mode=batch', () => {
	assert.equal(isBatch({ query: { mode: 'batch' } }), true);
	assert.equal(isBatch({ query: { src: 'dmm' } }), false);
});

test('normalizeQuery 去重、去空白并规范化布尔参数', () => {
	const q = normalizeQuery({ query: {
		codes: ' A , B ,A,, C ',
		only: 'FALENO',
		refresh: '1',
		debug: '1',
		quality: ' 720p ',
		no_preview: '1',
	} });
	assert.deepEqual(q.codes, ['A', 'B', 'C']);
	assert.equal(q.only, 'faleno');
	assert.equal(q.refresh, true);
	assert.equal(q.debug, true);
	assert.equal(q.quality, '720p');
	assert.equal(q.noPreview, true);
});

test('errorResult 带 no-store，503 额外带 Retry-After', () => {
	const notFound = errorResult('ITEM_NOT_FOUND');
	assert.equal(notFound.status, 404);
	assert.equal(notFound.body.code, 40401);
	assert.equal(notFound.headers['Cache-Control'], 'no-store');
	const unavailable = errorResult('SOURCE_UNAVAILABLE');
	assert.equal(unavailable.headers['Retry-After'], '5');
});

test('okResult 默认 200，headers 可覆盖', () => {
	assert.equal(okResult({ a: 1 }).status, 200);
	assert.equal(okResult({}, { 'Cache-Control': 'no-store' }).headers['Cache-Control'], 'no-store');
});

test('sendResult：D2PASS 补 CDN 缓存头，DMM 不设置 Cache-Control', () => {
	const d2p = mockRes();
	sendResult(d2p, 'd2pass', okResult({ ok: true }));
	assert.match(d2p.headers['Cache-Control'], /s-maxage=86400/);
	const dmm = mockRes();
	sendResult(dmm, 'dmm', okResult({ ok: true }));
	assert.equal(dmm.headers['Cache-Control'], undefined);
	assert.equal(dmm.headers['Access-Control-Allow-Origin'], '*');
});

test('sendResult：handler 显式 no-store 不被默认头覆盖', () => {
	const res = mockRes();
	sendResult(res, 'd2pass', okResult({}, { 'Cache-Control': 'no-store' }));
	assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('sendOptions 返回 204 且带 CORS 头', () => {
	const res = mockRes();
	sendOptions(res);
	assert.equal(res.statusCode, 204);
	for (const key of Object.keys(CORS_HEADERS)) assert.ok(res.headers[key]);
});

test('checkApiKey：未配置 / 缺 Key / 错 Key / 正确', () => {
	const original = process.env.API_KEY;
	try {
		delete process.env.API_KEY;
		assert.equal(checkApiKey({ query: {}, headers: {} }).body.code, 50301);

		process.env.API_KEY = 'secret';
		assert.equal(checkApiKey({ query: {}, headers: {} }).body.code, 40101);
		assert.equal(checkApiKey({ query: { key: 'wrong' }, headers: {} }).body.code, 40301);
		assert.equal(checkApiKey({ query: { key: 'secret' }, headers: {} }), null);
		assert.equal(checkApiKey({ query: {}, headers: { 'x-api-key': 'secret' } }), null);
	} finally {
		if (original === undefined) delete process.env.API_KEY;
		else process.env.API_KEY = original;
	}
});

test('parseQualityHeight 只接受 NNNp，非法回退 320', () => {
	assert.equal(parseQualityHeight('320p'), 320);
	assert.equal(parseQualityHeight('720P'), 720);
	assert.equal(parseQualityHeight('1080'), 320);
	assert.equal(parseQualityHeight(null), 320);
});

test('readConfig 默认 320p 映射到 D2PASS 真实存在的档位', () => {
	const saved = { ...process.env };
	try {
		for (const key of ['PREVIEW_QUALITY', 'BATCH_MAX', 'RATE_LIMIT_PER_MIN']) delete process.env[key];
		const cfg = readConfig();
		assert.equal(cfg.previewQuality, '320p');
		assert.equal(cfg.targetHeight, 320);
		assert.equal(cfg.batchMax, 50);
		assert.equal(cfg.minHeight, 200);
		assert.equal(cfg.maxHeight, 440);
		assert.equal(cfg.previewOrder[0], '360p');
		assert.equal(cfg.heyzoOrder[0], 'sample_low');
	} finally {
		for (const key of Object.keys(process.env)) {
			if (!(key in saved)) delete process.env[key];
		}
		Object.assign(process.env, saved);
	}
});
