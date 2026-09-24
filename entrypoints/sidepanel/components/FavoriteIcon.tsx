import React from "react";

interface FavoriteIconProps {
	active: boolean;
}

// 收藏图标（金色书签）；未收藏时半透明，两态由 CSS 的 opacity 区分
export const FavoriteIcon: React.FC<FavoriteIconProps> = ({ active }) => (
	<svg
		className={`favorite-icon ${active ? "favorite-icon--active" : ""}`}
		viewBox="0 0 1024 1024"
		width="16"
		height="16"
		aria-hidden="true"
	>
		<path
			d="M832.8 63.9H191.2c-17.8 0-32.3 14.5-32.3 32.3V878c0 23.3 23.9 38.9 45.3 29.6L489.8 782l331.4 128.4c21.2 8.2 44-7.4 44-30.1V96.2c-0.1-17.9-14.5-32.3-32.4-32.3z"
			fill="#f59e0b"
		/>
	</svg>
);
