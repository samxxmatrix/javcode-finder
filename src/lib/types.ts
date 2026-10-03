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

export type PreviewLookupSource = "dmm" | "javtrailers" | "faleno" | "fc2";

export type PreviewPlaybackStatus =
	| "idle"
	| "loading"
	| "playing"
	| "not_found"
	| "failed";

export type PreviewLookupErrorKind =
	| "not_found"
	| "http"
	| "api"
	| "network"
	| "timeout";

export interface PreviewLookupError {
	source: PreviewLookupSource;
	kind: PreviewLookupErrorKind;
	status?: number;
	code?: number | string;
	error?: string;
	message?: string;
}

export interface PreviewMedia {
	source: PreviewLookupSource;
	detailUrl: string | null;
	contentId: string | null;
	title: string | null;
	shortTitle: string | null;
	coverUrl: string | null;
	previewUrl: string | null;
	previewType: "mp4" | "hls" | null;
}

export type PreviewResolution =
	| {
			status: "resolved";
			media: PreviewMedia;
			errors: PreviewLookupError[];
	  }
	| {
			status: "not_found";
			media: null;
			errors: PreviewLookupError[];
	  }
	| {
			status: "error";
			media: null;
			errors: PreviewLookupError[];
	  };
