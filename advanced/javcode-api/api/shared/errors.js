/**
 * 全站唯一错误表与结果构造。
 *
 * 为什么统一：合并前两个服务各维护一张字典，新增错误要改两处且容易漂移；
 * handler 只返回结构化结果，协议细节全部留给入口层。
 */

export const ERRORS = Object.freeze({
	MISSING_CODE: { status: 400, code: 40001, error: 'MISSING_CODE', message: 'Please provide a valid code.' },
	INVALID_CODE: { status: 400, code: 40002, error: 'INVALID_CODE', message: 'Code could not be normalized into a known format.' },
	TOO_MANY_CODES: { status: 400, code: 40003, error: 'TOO_MANY_CODES', message: 'Batch size exceeded.' },
	MISSING_API_KEY: { status: 401, code: 40101, error: 'MISSING_API_KEY', message: 'API Key is missing. Provide via query parameter ?key= or Header x-api-key.' },
	INVALID_API_KEY: { status: 403, code: 40301, error: 'INVALID_API_KEY', message: 'Invalid API Key provided.' },
	ITEM_NOT_FOUND: { status: 404, code: 40401, error: 'ITEM_NOT_FOUND', message: 'Item not found for the requested code.' },
	RATE_LIMITED: { status: 429, code: 42901, error: 'RATE_LIMITED', message: 'Too many requests. Slow down.' },
	SOURCE_UNAVAILABLE: { status: 503, code: 50301, error: 'SOURCE_UNAVAILABLE', message: 'Upstream source is temporarily unavailable. Please retry later.' },
	SERVER_ERROR: { status: 500, code: 50001, error: 'INTERNAL_SERVER_ERROR', message: 'An internal error occurred while processing your request.' },
	CONFIG_ERROR: { status: 503, code: 50301, error: 'SOURCE_UNAVAILABLE', message: 'API_KEY is not configured on the server.' },
});

/**
 * 把错误名转成 handler 可直接返回的结果对象。
 * @param {string} name ERRORS 中的键
 * @param {{message?: string, body?: object}} overrides 追加信息
 */
export function errorResult(name, overrides = {}) {
	const e = ERRORS[name] || ERRORS.SERVER_ERROR;
	const headers = { 'Cache-Control': 'no-store' };
	if (e.status === 503) headers['Retry-After'] = '5';
	return {
		status: e.status,
		body: {
			code: e.code,
			error: e.error,
			message: overrides.message || e.message,
			...(overrides.body || {}),
		},
		headers,
	};
}

/** 构造成功结果；headers 会覆盖入口层的默认缓存头。 */
export function okResult(body, headers = {}) {
	return { status: 200, body, headers };
}
