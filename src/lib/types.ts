export type SupportedLocale = "zh-hans" | "zh-hant" | "en";

export interface ExtractionResult {
	candidates: string[];
	truncated: boolean;
	unsupported?: boolean;
	/** 安全模式：整页 > 2 MiB 或候选撞 500 上限时进入，提示用户改扫视口内文本 */
	safeMode?: boolean;
}

export type PopupStatus =
	| "loading"
	| "results"
	| "no_candidates"
	| "unsupported_page"
	| "excluded_site"
	| "error";

export type PreviewLookupSource = "dmm" | "javtrailers" | "faleno" | "fc2" | "d2pass";

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

/**
 * 运行时回退的一档：来源 + 该源的封面/预览（任一可为 null）。
 *
 * 解析期按**资产可达性**排序填入（`cdn.faleno.net` 全球可达 → `pics.dmm.co.jp` 需日本 IP），
 * 数组下标即尝试顺序。UI 侧只在主媒体资产失败时按序推进，**不重新发起查询**
 * （数据必须复用解析期已取到的结果，否则"免费后备"退化成串行额外请求）。
 */
export interface PreviewFallbackTier {
	source: PreviewLookupSource;
	coverUrl: string | null;
	previewUrl: string | null;
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
	/**
	 * 有序后备层：仅含解析期**已并行取到**的其他源，且不含封面方自身。
	 * undefined = 无后备档（UI 不进入回退流程，直接判失败）。
	 */
	fallbackTiers?: PreviewFallbackTier[];
	/** 出演者原名（源站顺序，已拆分/去空/去重）；[] = 无 → 封面浮条不显示该侧 */
	performers: string[];
	/** 发布日（已按「配信開始日/配信日 → 商品発売日/発売日」选定并归一化为 YYYY-MM-DD）；null = 无 */
	releaseDate: string | null;
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
