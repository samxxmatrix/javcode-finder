/**
 * 统一 HTTP 响应层：CORS、OPTIONS、缓存头按来源分支。
 *
 * D2PASS 成功响应带 CDN 缓存头（与旧服务一致）；DMM 分支不设置 Cache-Control，
 * 否则 refresh=1 与 quality= 档位切换会被中间层缓存吃掉。
 */

export const CORS_HEADERS = Object.freeze({
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
	'Content-Type': 'application/json; charset=utf-8',
});

const D2PASS_CACHE = 'public, s-maxage=86400, stale-while-revalidate=604800';

/**
 * 发送 handler 返回的结构化结果。
 * @param {object} res Vercel Node 响应对象
 * @param {'dmm'|'d2pass'|'health'} src 来源分支
 * @param {{status?: number, body?: unknown, headers?: object}} result
 */
export function sendResult(res, src, result) {
	const { status = 200, body = {}, headers = {} } = result || {};
	for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value);
	for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
	if (!headers['Cache-Control'] && src === 'd2pass') {
		res.setHeader('Cache-Control', D2PASS_CACHE);
	}
	res.statusCode = status;
	res.end(JSON.stringify(body));
}

/** OPTIONS 预检统一放行，避免浏览器带 x-api-key 时预检失败。 */
export function sendOptions(res) {
	for (const [name, value] of Object.entries(CORS_HEADERS)) res.setHeader(name, value);
	res.statusCode = 204;
	res.end();
}
