import React from "react";

/**
 * 输入框内联清除按钮：有内容时显示在框内右侧，点击清空。
 * 样式依赖外层 wrapper 的 position: relative（浮于输入框右端，输入框需留出 padding-right）。
 */
export const ClearButton: React.FC<{
	show: boolean;
	onClick: () => void;
	title: string;
}> = ({ show, onClick, title }) => {
	if (!show) return null;
	return (
		<button
			type="button"
			className="settings-field__clear"
			onClick={onClick}
			title={title}
			aria-label={title}
		>
			<svg
				viewBox="0 0 20 20"
				fill="currentColor"
				width="12"
				height="12"
				aria-hidden="true"
			>
				<path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
			</svg>
		</button>
	);
};
