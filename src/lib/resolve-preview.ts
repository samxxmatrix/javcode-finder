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

function normalizeLookupError(
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
 * A DMM miss is not an error; a DMM failure is retained while JavTrailers runs.
 */
export async function resolvePreview({
	dmmEnabled,
	dmmLookup,
	javtrailersLookup,
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

	try {
		const javtrailersMedia = await javtrailersLookup();
		if (javtrailersMedia) {
			return { status: "resolved", media: javtrailersMedia, errors };
		}
		return { status: "not_found", media: null, errors };
	} catch (error) {
		errors.push(normalizeLookupError("javtrailers", error));
		return { status: "error", media: null, errors };
	}
}
