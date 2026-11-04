import { errorResult } from './errors.js';

/**
 * 校验全站唯一 API_KEY。
 *
 * 与旧服务的差别：不再支持「未配置就跳过校验」。服务端没配 Key 属部署错误，
 * 所有接口（含 /health）一律拒绝，避免把私有反代暴露成公开接口。
 * @returns {object|null} 错误结果；null 表示通过
 */
export function checkApiKey(req) {
	const configured = (process.env.API_KEY || '').trim();
	if (!configured) return errorResult('CONFIG_ERROR');
	const provided = req.headers?.['x-api-key'] || req.query?.key;
	if (!provided) return errorResult('MISSING_API_KEY');
	if (String(provided) !== configured) return errorResult('INVALID_API_KEY');
	return null;
}
