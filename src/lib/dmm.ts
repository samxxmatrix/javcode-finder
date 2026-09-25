export interface DmmLookupData {
	cid: string;
	channel: string;
	title: string | null;
	shortTitle: string | null;
	coverUrl: string | null;
	previewUrl: string | null;
	detailUrl: string;
}

/**
 * 拼接完整查询 URL：GET {base}/{code}?key={key}。
 * base 为空（未配置）时返回空串，调用方跳过请求。
 */
export function buildDmmLookupUrl(
	baseUrl: string,
	key: string,
	code: string,
): string {
	const trimmed = (baseUrl || "").trim().replace(/\/+$/, "");
	if (!trimmed || !code) return "";
	return `${trimmed}/${encodeURIComponent(code)}?key=${encodeURIComponent(key)}`;
}

/**
 * 拼接健康检查 URL：cid-only 接口（只做搜索，最轻量）
 */
export function buildDmmHealthUrl(
	baseUrl: string,
	key: string,
	code: string,
): string {
	const trimmed = (baseUrl || "").trim().replace(/\/+$/, "");
	if (!trimmed || !code) return "";
	return `${trimmed}/cid/${encodeURIComponent(code)}?key=${encodeURIComponent(key)}`;
}

/**
 * 校验并提取 DMM 查询响应；cid 缺失/非法时返回 null。
 */
export function parseDmmLookupResponse(data: unknown): DmmLookupData | null {
	const d = (data ?? {}) as Record<string, unknown>;
	if (typeof d.cid !== "string" || !d.cid) return null;
	return {
		cid: d.cid,
		channel: typeof d.channel === "string" ? d.channel : "",
		title: typeof d.title === "string" && d.title ? d.title : null,
		shortTitle:
			typeof d.short_title === "string" && d.short_title ? d.short_title : null,
		coverUrl:
			typeof d.cover_url === "string" && d.cover_url ? d.cover_url : null,
		previewUrl:
			typeof d.preview_url === "string" && d.preview_url ? d.preview_url : null,
		detailUrl:
			typeof d.detail_url === "string" && d.detail_url ? d.detail_url : "",
	};
}

/**
 * 格式化 DMM 接口错误（设置区错误行展示）；status 0 = 网络层错误。
 */
export function formatDmmError(status: number, data: unknown): string {
	const parsed = (data ?? {}) as { code?: number; message?: string };
	const code = typeof parsed.code === "number" ? ` [${parsed.code}]` : "";
	let message: string;
	if (typeof parsed.message === "string" && parsed.message) {
		message = parsed.message;
	} else if (status) {
		message = `HTTP ${status}`;
	} else {
		message = "网络错误";
	}
	return `DMM 接口错误${code}：${message}`;
}
