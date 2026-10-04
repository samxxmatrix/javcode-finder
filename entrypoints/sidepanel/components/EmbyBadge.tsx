import React from "react";
import {
	EMBY_BADGE_GREEN_PATH,
	EMBY_BADGE_VIEW_BOX,
	EMBY_BADGE_WHITE_PATH,
} from "../../../src/lib/emby-badge";

/**
 * 「已在 Emby 库中」标识：绿色星形 + 白色播放三角，纯标识、不可点击。
 * 第二条 path 含两个子路径（星形外框 + 播放三角），三角子路径绕向与星形相反；
 * 因此 nonzero 与 evenodd 都会把三角挖空，显式写 evenodd 只是自证意图、对未来改动更稳。
 * viewBox 裁到图形实际外接框（155→869），16px 下才与收藏书签视觉等大。
 *
 * path 与 viewBox 来自 src/lib/emby-badge.ts —— 目标页黄点的 Emby 图标用同一份常量
 * （那边是字符串注入），改图标只改一处，不会出现面板与页面两个形状。
 */
export const EmbyBadge: React.FC = () => (
	<svg
		className="emby-badge"
		viewBox={EMBY_BADGE_VIEW_BOX}
		width="16"
		height="16"
		aria-hidden="true"
	>
		<path d={EMBY_BADGE_WHITE_PATH} fill="#FFFFFF" />
		<path fillRule="evenodd" fill="#06B831" d={EMBY_BADGE_GREEN_PATH} />
	</svg>
);
