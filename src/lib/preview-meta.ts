import type { PreviewPlaybackStatus } from "./types";

export interface MetaRowInput {
	playbackStatus: PreviewPlaybackStatus;
	/**
	 * 封面层是否正在渲染（**不是**"有没有封面地址"）。
	 * 用"层可见"而不是"有封面"：源站没给封面时（如老的 caribbeancom 号）面板照样渲染封面层
	 * （黑底 + 播放按钮），这时出演者/日期仍然应该显示 —— 2026-10-10 用户反馈触发。
	 */
	coverLayerVisible: boolean;
	/** 出演者原名（源站顺序）；人名属专有名词，一律按原样展示 */
	performers: readonly string[];
	releaseDate: string | null;
}

export interface MetaRow {
	show: boolean;
	/** 画面上的出演者文本（空格连接的原名） */
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
 * 出演者姓名属专有名词，一律展示原名，不做逐名翻译。
 */
export function buildMetaRow({
	playbackStatus,
	coverLayerVisible,
	performers,
	releaseDate,
}: MetaRowInput): MetaRow {
	const names = performers.join(" ");
	return {
		show:
			playbackStatus === "idle" &&
			coverLayerVisible &&
			(performers.length > 0 || Boolean(releaseDate)),
		performersText: names,
		fullNames: names,
		releaseDate,
	};
}
