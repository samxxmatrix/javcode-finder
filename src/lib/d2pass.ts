import type {
	PreviewLookupError,
	PreviewLookupErrorKind,
} from "./types";

/**
 * D2PASS（无码源）查询响应的解析与错误归一化。
 * 契约见 docs/d2pass-api接口文档.md §3.2 / §3.4，字段口径与 DMM 源一致：
 * `short_title` = 标题（金色行）、`title` = 剧情介绍（灰色行）。
 *
 * 说明：接口的 `class` 字段（censored/amateur/unknown）只在接口侧用于早退，
 * 客户端不据此分流 —— 404 一律按查无（spec §7：形态判定与源结论冲突时以源为准）。
 */

export interface D2passLookupData {
	/** 接口归一化后的番号（大写、保留原分隔符）→ PreviewMedia.contentId */
	code: string;
	/** 剧情介绍（长文）→ 灰色行 */
	title: string | null;
	/** 作品名（短标题）→ 金色行 */
	shortTitle: string | null;
	/** 封面：优先 D2Pass 的 cover_url，回退源站 cover_url_alt */
	coverUrl: string | null;
	previewUrl: string | null;
	previewType: "mp4" | "hls" | null;
	/** D2Pass 商品页；未在 D2Pass 上架时为 null */
	detailUrl: string | null;
}

export interface D2passLookupErrorData {
	kind: PreviewLookupErrorKind;
	status: number;
	code?: number | string;
	error?: string;
	message?: string;
}

/**
 * 补全协议相对封面地址：`//www.heyzo.com/...`；不补 `https:` 的话
 * 面板会把它解析成 `chrome-extension://...` 而加载失败。
 *
 * 归因：会漏出未归一值的是 **bifrost JSON 路径**
 * （`docs/d2pass-api/api/lib/sites.js:396` 的 `coverAlt: j.ThumbHigh || j.MovieThumb || null`
 * 完全不做协议处理）；`:427` 的 `coverAlt: coverFromHtml(page.text)` 上游已经归一过了。
 *
 * 适用边界：本函数只处理位置 0 的 `//`，**不**把 `http://` 升级成 `https://`
 * —— 上游 `coverFromHtml`（`:282-283`）会升级，此处是有意为之的真子集，
 * 只兜住会导致面板加载失败的那一种形态。
 *
 * 作用范围：`cover_url` 与 `cover_url_alt` 都走这里；
 * `preview_url` / `d2pass_url` **不**做此处理（由服务端模板保证绝对 https）。
 */
function normalizeCoverUrl(value: unknown): string | null {
	if (typeof value !== "string" || !value) return null;
	return value.startsWith("//") ? `https:${value}` : value;
}

function readCoverUrl(data: Record<string, unknown>): string | null {
	return (
		normalizeCoverUrl(data.cover_url) ?? normalizeCoverUrl(data.cover_url_alt)
	);
}

function readPreviewType(value: unknown): "mp4" | "hls" | null {
	if (value === "mp4") return "mp4";
	if (value === "hls") return "hls";
	return null;
}

/** 校验并提取 D2PASS 查询响应；code 缺失/非法时返回 null（等同查无） */
export function parseD2passLookupResponse(
	data: unknown,
): D2passLookupData | null {
	const d = (data ?? {}) as Record<string, unknown>;
	if (typeof d.code !== "string" || !d.code) return null;
	return {
		code: d.code,
		title: typeof d.title === "string" && d.title ? d.title : null,
		shortTitle:
			typeof d.short_title === "string" && d.short_title ? d.short_title : null,
		coverUrl: readCoverUrl(d),
		previewUrl:
			typeof d.preview_url === "string" && d.preview_url ? d.preview_url : null,
		previewType: readPreviewType(d.preview_type),
		detailUrl:
			typeof d.d2pass_url === "string" && d.d2pass_url ? d.d2pass_url : null,
	};
}

/**
 * 归一化 D2PASS 的失败响应：
 * - `status` 为 0 → `network`：网络层错误最先判，不能被响应体里的 code 伪装成查无
 * - `status` 在 401/403/429/503 之一、或 `code`/`error` 命中接口错误表 ⇒ `api`
 *   （`503 SOURCE_UNAVAILABLE`：源站**无法定性**，必须保留在 errors、绝不降级成查无，
 *   否则会落进"此号无预告片"的终态，源站恢复后也不会重查）
 * - `404 ITEM_NOT_FOUND`（含带 class 的早退响应）→ `not_found`：确认查无，不进 errors
 * - 其余非 2xx（含裸 500）→ `http`，沿用 DMM 源口径
 *
 * `api`（故障）排在 `not_found`（查无）之前是本模块的不变量：矛盾组合
 * （如 503 + `code 40401`、404 + `code 50301`）一律取故障方向。
 */
export function parseD2passLookupError(
	status: number,
	data: unknown,
): D2passLookupErrorData {
	const parsed = (data ?? {}) as {
		code?: unknown;
		error?: unknown;
		message?: unknown;
	};
	const code =
		typeof parsed.code === "number" || typeof parsed.code === "string"
			? parsed.code
			: undefined;
	const error = typeof parsed.error === "string" ? parsed.error : undefined;
	const message =
		typeof parsed.message === "string" ? parsed.message : undefined;
	const notFound =
		status === 404 ||
		code === 40401 ||
		code === "40401" ||
		error === "ITEM_NOT_FOUND";
	const apiLike =
		status === 503 ||
		status === 401 ||
		status === 403 ||
		status === 429 ||
		code === 50301 ||
		code === "50301" ||
		code === 40101 ||
		code === "40101" ||
		code === 40301 ||
		code === "40301" ||
		code === 42901 ||
		code === "42901" ||
		code === 50001 ||
		code === "50001" ||
		error === "SOURCE_UNAVAILABLE";

	return {
		kind:
			status === 0
				? "network"
				: apiLike
					? "api"
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
 * 读取成功的查询响应。JSON 解析失败算接口错误（不是网络错误，也不是查无）。
 */
export async function readD2passLookupResponse(response: {
	status: number;
	json: () => Promise<unknown>;
}): Promise<D2passLookupData | null> {
	let data: unknown;
	try {
		data = await response.json();
	} catch {
		throw {
			source: "d2pass",
			kind: "api",
			status: response.status,
		} satisfies PreviewLookupError;
	}

	const parsed = parseD2passLookupResponse(data);
	if (parsed) return parsed;

	if (
		typeof data === "object" &&
		data !== null &&
		("error" in data || "message" in data)
	) {
		const apiError = parseD2passLookupError(response.status, data);
		if (apiError.kind !== "not_found") {
			throw { source: "d2pass", ...apiError } satisfies PreviewLookupError;
		}
	}
	return null;
}
