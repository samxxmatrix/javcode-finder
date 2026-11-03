import type { PreviewPlaybackStatus } from "./types";

/** 出演者逐名翻译的并发上限：名字通常 ≤ 10，限 4 足够快又不至于打爆 Worker */
export const PERFORMER_TRANSLATE_CONCURRENCY = 4;

export interface MetaRowInput {
	playbackStatus: PreviewPlaybackStatus;
	/**
	 * 封面层是否正在渲染（**不是**"有没有封面地址"）。
	 * 用"层可见"而不是"有封面"：源站没给封面时（如老的 caribbeancom 号）面板照样渲染封面层
	 * （黑底 + 播放按钮），这时出演者/日期仍然应该显示 —— 2026-10-10 用户反馈触发。
	 */
	coverLayerVisible: boolean;
	/** 出演者原名（源站顺序） */
	performers: readonly string[];
	/** 原名 → 译文；缺失或空白都回退原名 */
	translations: Readonly<Record<string, string>>;
	releaseDate: string | null;
}

export interface MetaRow {
	show: boolean;
	/** 画面上的出演者文本（空格连接，已用译文替换） */
	performersText: string;
	/** `title` 属性的完整名单（始终原名，便于悬停核对） */
	fullNames: string;
	releaseDate: string | null;
}

/**
 * 浮条的可见性与文本（见 spec §3 / §7.1）。
 * 可见条件：**idle（未点播放）+ 封面层在渲染 + 至少有一侧数据**。
 * 封面层在渲染但源站没给封面（黑底 + 播放按钮）时**照样显示** —— 信息与图片无关。
 * 一旦点播放（loading/playing/failed）就不再显示 —— 这是用户明确要求的行为。
 */
export function buildMetaRow({
	playbackStatus,
	coverLayerVisible,
	performers,
	translations,
	releaseDate,
}: MetaRowInput): MetaRow {
	const display = performers.map((name) => {
		const translated = translations[name];
		return typeof translated === "string" && translated.trim() ? translated : name;
	});
	return {
		show:
			playbackStatus === "idle" &&
			coverLayerVisible &&
			(performers.length > 0 || Boolean(releaseDate)),
		performersText: display.join(" "),
		fullNames: performers.join(" "),
		releaseDate,
	};
}
