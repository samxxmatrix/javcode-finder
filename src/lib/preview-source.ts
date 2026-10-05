import type { PreviewLookupSource } from "./types";

/**
 * 预览源的 UI 口径集中处。
 *
 * 面板里凡是要按"来源"分支的地方都必须走这里的谓词：新增数据源时只改一处，
 * 漏登记会立刻在 `test/preview-source.test.ts` 的真值表上暴露，而不是变成线上静默故障
 * （历史上 mp4 直链分支与短标题兜底两处硬编码比较就各自漏过一次）。
 */

/** 返回 mp4 直链的源：<video src> 直接播放，无需 hls.js 与 CORS 处理 */
export function isDirectMp4Source(
	source: PreviewLookupSource | null | undefined,
): boolean {
	return (
		source === "dmm" ||
		source === "faleno" ||
		source === "fc2" ||
		// D2PASS 预告片是模板直链（实测 206 video/mp4、无防盗链、无需 CORS）
		source === "d2pass"
	);
}

/**
 * 没有独立短标题字段、可直接用 title 充当短标题行的源（dmm 有 short_title，故不含）。
 * d2pass 同样**故意不含**：它有自己的 `short_title`（金色行），title 是剧情（灰色行），
 * 登记进来会在 short_title 缺失时把剧情当标题显示。
 */
export function canUseTitleAsShortTitle(
	source: PreviewLookupSource | null | undefined,
): boolean {
	return source === "javtrailers" || source === "faleno" || source === "fc2";
}

export type SourceLabelKey =
	| "dmmSourceLabel"
	| "javtrailersSourceLabel"
	| "falenoSourceLabel"
	| "fc2SourceLabel"
	| "d2passSourceLabel";

/** 错误来源标签：调用方用 `t[sourceLabelKey(source)]` 取文案 */
export function sourceLabelKey(source: PreviewLookupSource): SourceLabelKey {
	switch (source) {
		case "dmm":
			return "dmmSourceLabel";
		case "faleno":
			return "falenoSourceLabel";
		case "fc2":
			return "fc2SourceLabel";
		case "d2pass":
			return "d2passSourceLabel";
		default:
			return "javtrailersSourceLabel";
	}
}
