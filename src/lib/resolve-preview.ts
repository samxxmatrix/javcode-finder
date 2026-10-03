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
 * 链路:DMM(启用时)→ JavTrailers → FALENO(可选兜底)。
 * 前级未命中或抛错都继续下一级;DMM 查无不算错误,DMM 抛错保留在 errors。
 */
export async function resolvePreview({
	dmmEnabled,
	dmmLookup,
	javtrailersLookup,
	falenoLookup,
}: ResolvePreviewOptions): Promise<PreviewResolution> {
	const errors: PreviewLookupError[] = [];

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

	// failed 记录 javtrailers/faleno 是否抛错:兜底后仍未命中时据此报 error 而非 not_found
	let failed = false;

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
