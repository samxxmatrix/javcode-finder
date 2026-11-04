import type {
	PreviewFallbackTier,
	PreviewLookupError,
	PreviewLookupErrorKind,
	PreviewLookupSource,
	PreviewMedia,
	PreviewResolution,
} from "./types";

export interface ResolvePreviewOptions {
	lookupEnabled: boolean;
	dmmLookup: () => Promise<PreviewMedia | null>;
	javtrailersLookup: () => Promise<PreviewMedia | null>;
	/**
	 * FALENO 第二路：调用方**仅在番号前缀命中时**提供实现（`falenoLookup` 的有无就是"FNS 分支"开关）。
	 * 未提供时第二路是 DMM；提供时 DMM 常态不参与（只在 FALENO 查无/抛错后串行补查一次）。
	 */
	falenoLookup?: () => Promise<PreviewMedia | null>;
	// D2PASS(无码链首):调用方仅在开关打开且番号是无码形态时打开
	d2passEnabled?: boolean;
	d2passLookup?: () => Promise<PreviewMedia | null>;
}

function isLookupErrorKind(value: unknown): value is PreviewLookupErrorKind {
	return (
		value === "not_found" ||
		value === "http" ||
		value === "api" ||
		value === "network" ||
		value === "timeout"
	);
}

export function normalizeLookupError(
	source: PreviewLookupSource,
	error: unknown,
): PreviewLookupError {
	if (
		typeof error === "object" &&
		error !== null &&
		"source" in error &&
		error.source === source &&
		"kind" in error &&
		isLookupErrorKind(error.kind)
	) {
		const detail = error as Partial<PreviewLookupError>;
		return {
			source,
			kind: error.kind,
			...(typeof detail.status === "number" ? { status: detail.status } : {}),
			...(typeof detail.code === "number" || typeof detail.code === "string"
				? { code: detail.code }
				: {}),
			...(typeof detail.error === "string" ? { error: detail.error } : {}),
			...(typeof detail.message === "string"
				? { message: detail.message }
				: {}),
		};
	}

	const isTimeout =
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		error.name === "TimeoutError";
	return { source, kind: isTimeout ? "timeout" : "network" };
}

interface LookupOutcome {
	media: PreviewMedia | null;
	error: PreviewLookupError | null;
}

/** 并发取数用：把「命中 / 查无 / 抛错」收敛成同一种返回值，不让任何一路的异常打断另一路 */
async function runLookup(
	source: PreviewLookupSource,
	lookup: () => Promise<PreviewMedia | null>,
): Promise<LookupOutcome> {
	try {
		return { media: await lookup(), error: null };
	} catch (error) {
		return { media: null, error: normalizeLookupError(source, error) };
	}
}

/**
 * 后备档构造：只放"解析期已并行取到的第二路"，且必须排除封面方自身。
 * 该源的封面/预览都为 null 时不成档（UI 拿到空档只会白等一次失败）。
 */
function buildFallbackTier(
	media: PreviewMedia | null,
	coverSource: PreviewLookupSource,
): PreviewFallbackTier | null {
	if (!media || media.source === coverSource) return null;
	if (!media.coverUrl && !media.previewUrl) return null;
	return {
		source: media.source,
		coverUrl: media.coverUrl,
		previewUrl: media.previewUrl,
	};
}

/**
 * 解析预览：D2PASS（链首，先命中即胜，不参与合并）→ **JT ∥ 第二路** → 字段级合并。
 *
 * 为什么要并发 + 合并：封面/预览与标题的"最优来源"不同 ——
 * - **封面/预览**按**资产可达性**取（JavTrailers / FALENO 的 CDN 全球可达，DMM 需日本出口）；
 * - **标题/介绍/出演者/日期**按**数据完整度**取（DMM 商品名最全，其次 FALENO）。
 * 旧的"先命中即胜"让 DMM 一旦命中就直接 return，JT 与 FALENO 根本不执行，字段级优先级形同虚设。
 *
 * 第二路按番号类型二选一（由调用方决定并提供对应实现）：
 * - 提供 `falenoLookup`（前缀命中）→ `JT ∥ FALENO`；FALENO **查无或抛错都串行补查 DMM 一次**；
 * - 未提供 → `JT ∥ DMM`（`lookupEnabled` 为 false 时第二路为空）。
 *
 * 错误口径：
 * - 查无（not_found / 返回 null）不算错误、不进 errors；
 * - 故障（5xx / 超时 / 401 / 403）照实留在 errors（**收集层不吞事实**）；
 * - 但整体 `resolved` 时**丢弃 faleno 错误**（展示层不喧嚣）：大陆宽带直连 faleno.jp 必 403，
 *   若不丢，JT 封面/预览完全正常时面板也会常驻一条「查询失败：FALENO HTTP 403」。
 *   DMM 错误必须保留 —— `preview-state.ts` 的 `used_fallback` 提示依赖 `errors.some(dmm)`。
 */
export async function resolvePreview({
	d2passEnabled,
	d2passLookup,
	lookupEnabled,
	dmmLookup,
	javtrailersLookup,
	falenoLookup,
}: ResolvePreviewOptions): Promise<PreviewResolution> {
	const errors: PreviewLookupError[] = [];
	// failed 记录"非查无的失败":兜底后仍未命中时据此报 error 而非 not_found
	let failed = false;

	// 无码链首:D2PASS 只在开关打开且番号是无码形态时启用(FC2 号在调用方已提前返回)
	if (d2passEnabled && d2passLookup) {
		try {
			const d2passMedia = await d2passLookup();
			if (d2passMedia) {
				return { status: "resolved", media: d2passMedia, errors };
			}
		} catch (error) {
			const lookupError = normalizeLookupError("d2pass", error);
			// 404 ITEM_NOT_FOUND(含带 class 的早退响应)= 确认查无,链继续走下一源;
			// 503 SOURCE_UNAVAILABLE / 401 / 403 / 429 绝不能降级成 not_found ——
			// 降级会让面板抛出「暂无番号信息」(locales.ts:183)这种断言式结论,把源站故障
			// 说成"此号没有资料";若失败同时被丢弃(errors 为空),连错误行与"重新查询"入口都没了
			if (lookupError.kind !== "not_found") {
				failed = true;
				errors.push(lookupError);
			}
		}
	}

	// 第二路的判定：**不能**用"lookupEnabled"推断 FNS 分支 —— 非反代 + FNS 号同样提供
	// falenoLookup（直连 faleno.jp），此时 DMM 一次都不该查。
	const useFaleno = Boolean(falenoLookup);
	const useDmm = !useFaleno && lookupEnabled;

	const [jtOutcome, secondOutcome] = await Promise.all([
		runLookup("javtrailers", javtrailersLookup),
		useFaleno
			? runLookup("faleno", falenoLookup as () => Promise<PreviewMedia | null>)
			: useDmm
				? runLookup("dmm", dmmLookup)
				: Promise.resolve<LookupOutcome>({ media: null, error: null }),
	]);

	let secondMedia = secondOutcome.media;

	if (useFaleno) {
		if (!secondMedia) {
			if (secondOutcome.error && secondOutcome.error.kind !== "not_found") {
				failed = true;
				errors.push(secondOutcome.error);
			}
			// 串行补查：FALENO 查无与抛错都补查一次 DMM —— 兜住"DMM 有、faleno.jp 无"的号，
			// 也兜住反代抖动。仍然受 lookupEnabled 门闸约束（非反代用户不该因 FNS 号去查 DMM）。
			if (lookupEnabled) {
				const dmmRetry = await runLookup("dmm", dmmLookup);
				secondMedia = dmmRetry.media;
				if (dmmRetry.error && dmmRetry.error.kind !== "not_found") {
					errors.push(dmmRetry.error);
				}
			}
		}
	} else if (
		useDmm &&
		secondOutcome.error &&
		secondOutcome.error.kind !== "not_found"
	) {
		// DMM 故障照旧留痕，但**不**把整轮判成 error：历史口径是"DMM 报错 + 无人命中 = not_found"，
		// 因为 DMM 报错多半是 Key/配额/地址问题，用户看错误行即可，不该断言"此号没有资料"。
		errors.push(secondOutcome.error);
	}

	if (jtOutcome.error) {
		failed = true;
		errors.push(jtOutcome.error);
	}

	// 封面方 = JT 优先（资产全球可达）；标题方 = 第二路优先（数据更全）。
	// 合并后 source 取封面方：UI 里 isDirectMp4Source / 封面兜底 / DNR CORS 都随 source 自然正确。
	const coverProvider = jtOutcome.media ?? secondMedia;
	if (!coverProvider) {
		return failed
			? { status: "error", media: null, errors }
			: { status: "not_found", media: null, errors };
	}
	const titleProvider = secondMedia ?? coverProvider;

	const media: PreviewMedia = {
		...coverProvider,
		detailUrl: titleProvider.detailUrl ?? coverProvider.detailUrl,
		title: titleProvider.title ?? coverProvider.title,
		shortTitle: titleProvider.shortTitle ?? coverProvider.shortTitle,
		performers: titleProvider.performers.length
			? titleProvider.performers
			: coverProvider.performers,
		releaseDate: titleProvider.releaseDate ?? coverProvider.releaseDate,
	};

	const fallbackTier = buildFallbackTier(secondMedia, coverProvider.source);
	if (fallbackTier) media.fallbackTiers = [fallbackTier];

	return {
		status: "resolved",
		media,
		errors: errors.filter((error) => error.source !== "faleno"),
	};
}
