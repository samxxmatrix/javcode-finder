import type { PreviewLookupSource } from "./types";

/**
 * 预览源的 UI 口径集中处。
 *
 * 面板里凡是要按"来源"分支的地方都必须走这里的谓词：新增数据源时只改一处，
 * 漏登记会立刻在 `test/preview-source.test.ts` 的真值表上暴露，而不是变成线上静默故障
 * （历史上硬编码比较一共漏过三处：mp4 直链分支、短标题兜底，以及
 * `TrailerPreview.tsx` 的封面兜底判断——第三处至今仍是硬编码，行为恰好正确故未改）。
 *
 * ⚠️ 这张真值表**本身是手工清单，机制上不保证穷尽**：`sourceLabelKey` 的 `default`
 * 会让漏登记的新源静默伪装成 JavTrailers，两个谓词则会静默落 `false`。
 * 编译期护栏在 `test/preview-source.test.ts` 的 `SOURCE_MATRIX`（`Record<PreviewLookupSource, …>`）：
 * 往 `types.ts` 的 `PreviewLookupSource` 加一个源，`npm run compile` 立刻报 `Property 'xxx' is missing`。
 */

/** 返回 mp4 直链的源：<video src> 直接播放，无需 hls.js 与 CORS 处理 */
export function isDirectMp4Source(
	source: PreviewLookupSource | null | undefined,
): boolean {
	return (
		source === "dmm" ||
		source === "faleno" ||
		source === "fc2" ||
		// D2PASS 预告片默认是模板直链（实测 206 video/mp4、无防盗链、无需 CORS）。
		// ⚠️ 已知限制：接口 `preview_type` 理论上可为 `"hls"`（mp4 全部失败时的兜底），
		// 而 `PreviewMedia.previewType` 全仓库没有任何读取点，故此处会把 m3u8 当 mp4 塞进
		// `<video src>`，Chromium 上表现为"播放失败"（Safari 原生支持 HLS 故正常）。
		// 只把本谓词改掉**无效**：DNR 只给 `media.javtrailers.com` 注入 CORS 头，
		// 改落 hls.js 分支后 Hey動画 的 m3u8 依然过不了 CORS，可见结果还是"播放失败"。
		source === "d2pass"
	);
}

/**
 * 没有独立短标题字段、可直接用 title 充当短标题行的源（dmm 有 short_title，故不含）。
 * d2pass 同样**故意不含**：它有自己的 `short_title`（金色行），title 是剧情（灰色行），
 * 登记进来会在 short_title 缺失时把剧情当标题显示。
 * 反过来也要知道：**不登记**时若 `short_title` 缺失，两个标题行会同时为空
 * （`TrailerPreview` 的灰色行以 `shortTitle` 是否存在为开关），剧情完全不显示 ——
 * 这是刻意选择的显示口径，不是"回退到 title"的兜底。
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
