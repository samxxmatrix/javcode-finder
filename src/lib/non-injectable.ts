/**
 * 判断注入失败是否属于「页面本身不接受脚本」这一类预期结果。
 * 只静默错误页 / chrome-error / chrome:// 内部页的固定拒绝文案；权限缺失、
 * 参数不可序列化等真实故障必须继续告警，否则会被一起吞掉。
 *
 * @param err - scripting.executeScript 抛出的错误
 * @returns 属于不可注入页面返回 true
 */
export function isNonInjectablePageError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return /showing error page|chrome-error:\/\/|cannot access (?:a )?chrome:\/\/ url/i.test(
		message,
	);
}
