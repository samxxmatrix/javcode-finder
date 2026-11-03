import React from "react";

interface FavoriteIconProps {
	active: boolean;
	/**
	 * 未收藏时的形态：
	 * - "solid"（默认）：灰色实心，用于预告片头部的「加入收藏」；
	 * - "outline"：空心描边，仅用于「收藏夹」切换按钮。
	 * 已收藏时无论哪种形态都是金色实心。
	 */
	variant?: "solid" | "outline";
}

// 收藏图标（书签）：金色实心 = 已收藏；灰色实心 = 未收藏（预览区）；空心描边 = 未开启（收藏夹按钮）。
// 书签路径取设计稿的瘦长比例（20 单位视图内宽 10、高 16），比旧版更窄、不再显胖。
export const FavoriteIcon: React.FC<FavoriteIconProps> = ({
	active,
	variant = "solid",
}) => {
	const outline = !active && variant === "outline";
	return (
		<svg
			className={`favorite-icon ${active ? "favorite-icon--active" : ""} ${
				outline ? "favorite-icon--outline" : ""
			}`}
			viewBox="0 0 20 20"
			width="16"
			height="16"
			fill={active ? "#f59e0b" : outline ? "none" : "#a1a1aa"}
			stroke={outline ? "currentColor" : "none"}
			strokeWidth={outline ? 1.6 : 0}
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M6 2h8a1 1 0 0 1 1 1v15l-5-3.5L5 18V3a1 1 0 0 1 1-1z" />
		</svg>
	);
};
