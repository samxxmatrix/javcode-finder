import { messages } from "./locales";
import { pickReleaseDate, toPerformers } from "./release-meta";
import type {
	PreviewLookupError,
	PreviewLookupErrorKind,
	SupportedLocale,
} from "./types";

export interface DmmLookupData {
	cid: string;
	channel: string;
	title: string | null;
	shortTitle: string | null;
	coverUrl: string | null;
	previewUrl: string | null;
	detailUrl: string;
	/** 出演者（源站顺序，已拆分/去空/去重）；反代给数组，拿不到为空数组 */
	performers: string[];
	/** 发布日（配信開始日/配信日 优先，回退 商品発売日/発売日；已归一化为 YYYY-MM-DD） */
	releaseDate: string | null;
}

export interface DmmLookupErrorData {
	kind: PreviewLookupErrorKind;
	status: number;
	code?: number | string;
	error?: string;
	message?: string;
}

/**
 * 反代入口 URL 通用构造:去尾斜杠 + 可选路径段 + 编码番号 + Key。
 * base 为空（未配置）时返回空串，调用方跳过请求。
 */
function buildProxyUrl(
	baseUrl: string,
	segments: string[],
	key: string,
	code: string,
): string {
	const trimmed = (baseUrl || "").trim().replace(/\/+$/, "");
	if (!trimmed || !code) return "";
	const path = segments.map((segment) => `/${segment}`).join("");
	return `${trimmed}${path}/${encodeURIComponent(code)}?key=${encodeURIComponent(key)}`;
}

/**
 * 拼接完整查询 URL：GET {base}/dmm/{code}?key={key}。
 * base 为空（未配置）时返回空串，调用方跳过请求。
 */
export function buildDmmLookupUrl(
	baseUrl: string,
	key: string,
	code: string,
): string {
	return buildProxyUrl(baseUrl, ["dmm"], key, code);
}

/**
 * 拼接 FALENO 查询 URL：GET {base}/faleno/{code}?key={key}。
 * 与 DMM 共用同一反代入口（东京出口 + 永久缓存），响应形状一致。
 */
export function buildFalenoLookupUrl(
	baseUrl: string,
	key: string,
	code: string,
): string {
	return buildProxyUrl(baseUrl, ["faleno"], key, code);
}

/**
 * 拼接 D2PASS（无码源）查询 URL：GET {base}/d2pass/{code}?key={key}。
 * 合并后三个查询各有显式前缀，不再有根路径通配。
 */
export function buildD2passLookupUrl(
	baseUrl: string,
	key: string,
	code: string,
): string {
	return buildProxyUrl(baseUrl, ["d2pass"], key, code);
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
		// 反代契约（spec §4.2）：`actresses` 数组 / `delivery_date`（配信開始日・配信日，可能是
		// ISO 时间戳如 "2026-09-30T15:00:00Z"）/ `sale_date`（商品発売日・発売日），
		// 都是原始抓取值；归一化与优先级在本端做（老反代/老缓存缺字段时退化为空值）
		performers: toPerformers(d.actresses),
		releaseDate: pickReleaseDate(d.delivery_date, d.sale_date),
	};
}

/**
 * Reads a successful lookup response. Invalid JSON is an API response error,
 * not a network failure or a missing lookup result.
 */
export async function readDmmLookupResponse(response: {
	status: number;
	json: () => Promise<unknown>;
}): Promise<DmmLookupData | null> {
	let data: unknown;
	try {
		data = await response.json();
	} catch {
		throw {
			source: "dmm",
			kind: "api",
			status: response.status,
		} satisfies PreviewLookupError;
	}

	const parsed = parseDmmLookupResponse(data);
	if (parsed) return parsed;

	if (
		typeof data === "object" &&
		data !== null &&
		("error" in data || "message" in data)
	) {
		const apiError = parseDmmLookupError(response.status, data);
		if (apiError.kind !== "not_found") {
			throw { source: "dmm", ...apiError } satisfies PreviewLookupError;
		}
	}
	return null;
}

/**
 * Extracts a safe, structured error from a failed DMM lookup response.
 * DMM documents HTTP 404 and ITEM_NOT_FOUND as a missing lookup result.
 */
export function parseDmmLookupError(
	status: number,
	data: unknown,
): DmmLookupErrorData {
	const parsed = (data ?? {}) as {
		code?: unknown;
		error?: unknown;
		message?: unknown;
	};
	const code =
		typeof parsed.code === "number" || typeof parsed.code === "string"
			? parsed.code
			: undefined;
	const error =
		typeof parsed.error === "string" ? parsed.error : undefined;
	const message =
		typeof parsed.message === "string" ? parsed.message : undefined;
	const notFound =
		status === 404 ||
		code === 40401 ||
		code === "40401" ||
		error === "ITEM_NOT_FOUND";

	return {
		kind:
			status === 0
				? "network"
				: notFound
					? "not_found"
					: status >= 200 && status < 300
						? "api"
						: "http",
		status,
		...(code !== undefined ? { code } : {}),
		...(error !== undefined ? { error } : {}),
		...(message !== undefined ? { message } : {}),
	};
}

/**
 * 格式化 DMM 接口错误（设置区错误行展示）；status 0 = 网络层错误。
 * 前缀与兜底短语按界面语言；服务端 message 按原样显示。
 */
export function formatDmmError(
	status: number,
	data: unknown,
	locale: SupportedLocale = "zh-hans",
): string {
	const m = messages[locale];
	const parsed = (data ?? {}) as { code?: number; message?: string };
	const code = typeof parsed.code === "number" ? ` [${parsed.code}]` : "";
	let message: string;
	if (typeof parsed.message === "string" && parsed.message) {
		message = parsed.message;
	} else if (status) {
		message = `HTTP ${status}`;
	} else {
		message = m.networkError;
	}
	return `${m.dmmError}${code}：${message}`;
}
