import type {
	PreviewLookupError,
	PreviewLookupErrorKind,
	PreviewLookupSource,
	PreviewMedia,
	PreviewResolution,
} from "./types";

export interface ResolvePreviewOptions {
	dmmEnabled: boolean;
	dmmLookup: () => Promise<PreviewMedia | null>;
	javtrailersLookup: () => Promise<PreviewMedia | null>;
	// FALENO 兜底:调用方仅在番号前缀命中时提供实现;未提供时保持原有两级链路
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

/**
 * Resolves preview data in source priority order without losing lookup failures.
 * 链路:D2PASS(开关打开且番号是无码形态时,链首) → DMM(启用时) → JavTrailers → FALENO(可选兜底)。
 * D2PASS 的 not_found 等同查无、其余失败留在 errors。
 * 前级未命中或抛错都继续下一级;DMM 查无不算错误,DMM 抛错保留在 errors。
 */
export async function resolvePreview({
	d2passEnabled,
	d2passLookup,
	dmmEnabled,
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
			// 那会落进"此号无预告片"的终态,源站恢复后也不会重查
			if (lookupError.kind !== "not_found") {
				failed = true;
				errors.push(lookupError);
			}
		}
	}

	if (dmmEnabled) {
		try {
			const dmmMedia = await dmmLookup();
			if (dmmMedia) {
				return { status: "resolved", media: dmmMedia, errors };
			}
		} catch (error) {
			const lookupError = normalizeLookupError("dmm", error);
			if (lookupError.kind !== "not_found") errors.push(lookupError);
		}
	}

	// javtrailers/faleno 是否抛错沿用上面的 failed 标记
	try {
		const javtrailersMedia = await javtrailersLookup();
		if (javtrailersMedia) {
			return { status: "resolved", media: javtrailersMedia, errors };
		}
	} catch (error) {
		failed = true;
		errors.push(normalizeLookupError("javtrailers", error));
	}

	if (falenoLookup) {
		try {
			const falenoMedia = await falenoLookup();
			if (falenoMedia) {
				return { status: "resolved", media: falenoMedia, errors };
			}
		} catch (error) {
			failed = true;
			errors.push(normalizeLookupError("faleno", error));
		}
	}

	return failed
		? { status: "error", media: null, errors }
		: { status: "not_found", media: null, errors };
}
