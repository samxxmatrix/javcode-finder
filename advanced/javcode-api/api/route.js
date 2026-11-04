/**
 * 路由判定纯函数（无外部依赖，可单测）。
 *
 * 为什么独立成模块：dispatcher 会连带 import 两个业务 handler（含 redis 等依赖），
 * 直接测 dispatcher 会拉起整条依赖链；把判定逻辑隔离出来才能用 node --test 轻量验证。
 */

/** 公共响应头：两个 handler 会各自再设一遍，重复设置同值无害。 */
export const COMMON_HEADERS = Object.freeze({
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
	'Content-Type': 'application/json; charset=utf-8',
});

/**
 * 决定请求交给哪个 handler。
 *
 * rewrite 会把 src 注入 req.query；缺失时默认 dmm，兼容旧的直连 `/api?code=xxx`。
 * 未知值一律落到 dmm（fail-closed 到最保守的分支），不引入新的错误形态。
 */
export function resolveSource(req) {
	const raw = String(req?.query?.src ?? '').trim().toLowerCase();
	if (raw === 'd2pass') return 'd2pass';
	if (raw === 'health') return 'health';
	return 'dmm';
}
