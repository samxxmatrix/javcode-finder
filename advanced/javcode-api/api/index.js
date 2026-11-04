/**
 * 合并反代唯一入口：只处理协议层，不含任何番号业务逻辑。
 *
 * 顺序固定：OPTIONS → 鉴权 → health → 按 src 分发 → 统一发送。
 * 两个 handler 只返回 {status, body, headers}，不接触响应对象。
 */

import { checkApiKey } from '../server/shared/auth.js';
import { errorResult, okResult } from '../server/shared/errors.js';
import { sendResult, sendOptions } from '../server/shared/respond.js';
import { resolveSource, isBatch } from '../server/shared/router.js';
import { handleDmm, handleDmmBatch } from '../server/handlers/dmm.js';
import { handleD2pass, handleD2passBatch } from '../server/handlers/d2pass.js';

export default async function handler(req, res) {
	if (req.method === 'OPTIONS') {
		sendOptions(res);
		return;
	}

	const src = resolveSource(req);
	const authError = checkApiKey(req);
	if (authError) {
		sendResult(res, src, authError);
		return;
	}

	// 走到这里说明服务活着且 API Key 正确，一次请求同时验证两件事
	if (src === 'health') {
		sendResult(res, 'health', okResult(
			{ ok: true, service: 'javcode-api' },
			{ 'Cache-Control': 'no-store' },
		));
		return;
	}

	try {
		const batch = isBatch(req);
		const result = src === 'd2pass'
			? await (batch ? handleD2passBatch(req) : handleD2pass(req))
			: await (batch ? handleDmmBatch(req) : handleDmm(req));
		sendResult(res, src, result || errorResult('SERVER_ERROR'));
	} catch (error) {
		// 只打印错误类型与消息，绝不打印请求参数（含 key）
		console.error('[javcode-api]', error?.name || 'Error', error?.message || '');
		sendResult(res, src, errorResult('SERVER_ERROR'));
	}
}
