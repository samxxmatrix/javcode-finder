export type SupportedLocale = "zh-hans" | "zh-hant" | "en";

export interface ExtractionResult {
	candidates: string[];
	truncated: boolean;
	unsupported?: boolean;
}

export type PopupStatus =
	| "loading"
	| "results"
	| "no_candidates"
	| "unsupported_page"
	| "excluded_site"
	| "error";
