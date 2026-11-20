/**
 * 侧边栏番号列表的「揭示」计算：给定选中番号，算出该翻到第几页、以及翻页后
 * 列表容器该滚到多少。纯函数、不碰 DOM，便于把分页边界与居中口径用测试钉死。
 */

/**
 * 番号在去重后的扁平列表里属于第几页（0 基）。
 *
 * 用扁平 index / PAGE_SIZE 而不是 per-page 列表自己的 indexOf：调用方拿到的是
 * 全局下标，翻页后 item 才会出现在 DOM 里；找不到返回 -1，让调用方直接跳过。
 */
export function findCodePage(
	codes: readonly string[],
	code: string,
	pageSize: number,
): number {
	const index = codes.indexOf(code);
	return index < 0 ? -1 : Math.floor(index / pageSize);
}

export interface CenterScrollInput {
	/** 条目 getBoundingClientRect().top */
	itemTop: number;
	/** 条目 getBoundingClientRect().height */
	itemHeight: number;
	/** 列表容器 getBoundingClientRect().top */
	viewTop: number;
	/** 列表容器 getBoundingClientRect().height */
	viewHeight: number;
	/** 列表容器当前 scrollTop */
	scrollTop: number;
}

/**
 * 算出把条目移到列表容器中间所需的 scrollTop；条目已完整可见时返回 null。
 *
 * 只返回目标 scrollTop，由调用方赋给**内层列表容器**——绝不能用 scrollIntoView，
 * 那会连带滚动外层 popup-main，把刚打开的预览卡片顶出视野。
 *
 * 条目比容器高时退化成顶部对齐（居中偏移取 0），否则 `(viewHeight - itemHeight)/2`
 * 为负会把条目越推越上。结果钳到 0，避免容器已在顶部时算出负 scrollTop。
 */
export function computeCenterScrollTop(
	input: CenterScrollInput,
	force = false,
): number | null {
	const { itemTop, itemHeight, viewTop, viewHeight, scrollTop } = input;
	const relativeTop = itemTop - viewTop;
	const relativeBottom = relativeTop + itemHeight;

	// 完整可见就不动，避免用户手动滚动后被无谓拉回中间。
	// force=true 用于异步补偿：预览简介到达后列表已下移，即便条目仍完整可见，
	// 也要把它重新拉回正中间，消除「先居中、简介加载后又下移」的跳动。
	if (!force && relativeTop >= 0 && relativeBottom <= viewHeight) return null;

	const offset =
		itemHeight >= viewHeight ? 0 : (viewHeight - itemHeight) / 2;
	return Math.max(0, scrollTop + relativeTop - offset);
}
