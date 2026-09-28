import type {
	PreviewLookupError,
	PreviewPlaybackStatus,
	PreviewResolution,
} from "./types";

export type PreviewMediaMessageKey =
	| "no_number_information"
	| "playback_failed";

export type PreviewNoticeKey =
	| "lookup_error"
	| "used_fallback"
	| "no_trailer"
	| "playback_error";

export type PreviewRetryAction =
	| { type: "lookup" }
	| { type: "playback" }
	| { type: "multiple"; actions: ["playback", "lookup"] };

export interface PreviewPresentationInput {
	resolution: PreviewResolution | { status: "loading" };
	playbackStatus: PreviewPlaybackStatus;
	hasCover: boolean;
	hasTrailer: boolean;
	noticeDismissed: boolean;
}

export interface PreviewNotice {
	key: PreviewNoticeKey;
	errors: PreviewLookupError[];
	dismissible: boolean;
	actions?: { type: "dismiss" }[];
}

export interface PreviewPresentation {
	showSpinner: boolean;
	showCover: boolean;
	showPlayButton: boolean;
	mediaMessage: PreviewMediaMessageKey | null;
	notices: PreviewNotice[];
	retryAction: PreviewRetryAction | null;
}

export type PreviewNoticeEvent = "dismiss" | "lookup_retry" | "playback_retry";

export function transitionPreviewNotice(
	dismissed: boolean,
	event: PreviewNoticeEvent,
): boolean {
	return event === "dismiss";
}

export function getPreviewPresentation(
	input: PreviewPresentationInput,
): PreviewPresentation {
	const { resolution, playbackStatus, hasCover, hasTrailer, noticeDismissed } =
		input;

	if (resolution.status === "loading") {
		return {
			showSpinner: true,
			showCover: false,
			showPlayButton: false,
			mediaMessage: null,
			notices: [],
			retryAction: null,
		};
	}

	const lookupFailed = resolution.status === "error";
	const hasLookupErrors = lookupFailed || resolution.errors.length > 0;
	const playbackFailed = playbackStatus === "failed";
	const notices: PreviewNotice[] = [];

	if (hasLookupErrors) {
		notices.push({
			key: "lookup_error",
			errors: resolution.errors,
			dismissible: true,
			actions: [{ type: "dismiss" }],
		});
	}

	if (
		resolution.status === "resolved" &&
		resolution.media.source === "javtrailers" &&
		resolution.errors.some((error) => error.source === "dmm")
	) {
		notices.push({
			key: "used_fallback",
			errors: [],
			dismissible: true,
			actions: [{ type: "dismiss" }],
		});
	}

	if (resolution.status === "resolved" && !hasTrailer) {
		notices.push({
			key: "no_trailer",
			errors: [],
			dismissible: true,
			actions: [{ type: "dismiss" }],
		});
	}

	if (playbackFailed) {
		notices.push({
			key: "playback_error",
			errors: [],
			dismissible: true,
			actions: [{ type: "dismiss" }],
		});
	}

	const visibleNotices = noticeDismissed
		? notices.filter((notice) => !notice.dismissible)
		: notices;
	const hasLookupRetry = hasLookupErrors;
	const retryAction: PreviewRetryAction | null =
		playbackFailed && hasLookupRetry
			? { type: "multiple", actions: ["playback", "lookup"] }
			: playbackFailed
				? { type: "playback" }
				: hasLookupRetry
					? { type: "lookup" }
					: null;

	return {
		showSpinner: false,
		showCover: resolution.status === "resolved" && hasCover,
		showPlayButton: resolution.status === "resolved" && hasTrailer,
		mediaMessage: playbackFailed
			? "playback_failed"
			: resolution.status === "not_found"
				? "no_number_information"
				: null,
		notices: visibleNotices,
		retryAction,
	};
}
