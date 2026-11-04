/**
 * 路由判定纯函数（无外部依赖，可单测）。
 *
 * vercel.json 的 rewrites 把 src / mode / code / only 注入 req.query；
 * 入口层只按 src 分发，不做番号识别（番号识别始终在扩展侧）。
 */

/** 对外路由清单，供文档与测试核对。 */
export const ROUTES = Object.freeze([
	'/health',
	'/dmm/batch',
	'/d2pass/batch',
	'/dmm/:code',
	'/cid/:code',
	'/faleno/:code',
	'/d2pass/:code',
]);

/** 判定来源；缺失或未知值默认 dmm（最保守分支）。 */
export function resolveSource(req) {
	const raw = String(req?.query?.src ?? '').trim().toLowerCase();
	if (raw === 'd2pass') return 'd2pass';
	if (raw === 'health') return 'health';
	return 'dmm';
}

/** 批量请求由 rewrite 注入 mode=batch；单查恒为 false。 */
export function isBatch(req) {
	return req?.query?.mode === 'batch';
}

/**
 * 规范化入口参数，保证两个 handler 读到的字段一致。
 * @returns {{code: string, codes: string[], only: string, refresh: boolean, debug: boolean, quality: string, noPreview: boolean}}
 */
export function normalizeQuery(req) {
	const q = req?.query || {};
	const codes = String(q.codes || '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return {
		code: String(q.code || '').trim(),
		codes: [...new Set(codes)],
		only: String(q.only || '').trim().toLowerCase(),
		refresh: q.refresh === '1',
		debug: q.debug === '1',
		quality: String(q.quality || '').trim(),
		noPreview: q.no_preview === '1',
	};
}
