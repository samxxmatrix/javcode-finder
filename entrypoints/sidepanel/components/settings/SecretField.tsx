import { useState } from "react";
import { ClearButton } from "../ClearButton";

interface SecretFieldProps {
	id: string;
	value: string;
	onChange: (value: string) => void;
	onClear: () => void;
	placeholder?: string;
	/** 密钥用等宽字体，与 URL / 用户名输入区分 */
	code?: boolean;
	clearLabel: string;
	showLabel: string;
	hideLabel: string;
}

/**
 * 密钥 / 密码输入行：默认掩码，右侧按钮切换明文，框内保留清除按钮。
 * 显示状态由组件自管 —— 每个字段互不干扰，也不占用 useSettingsDraft 的状态。
 * 布局：输入框 flex:1 + 独立的切换按钮（与 style.css 的 .secret-field__row 配套）。
 */
export function SecretField({
	id,
	value,
	onChange,
	onClear,
	placeholder,
	code = false,
	clearLabel,
	showLabel,
	hideLabel,
}: SecretFieldProps) {
	const [visible, setVisible] = useState(false);
	return (
		<div className="secret-field__row">
			<div className="settings-field__input-wrap">
				<input
					id={id}
					type={visible ? "text" : "password"}
					className={`settings-field__input${
						code ? " settings-field__input--code" : ""
					}`}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					spellCheck={false}
					autoComplete="off"
				/>
				<ClearButton
					show={Boolean(value)}
					onClick={onClear}
					title={clearLabel}
				/>
			</div>
			<button
				type="button"
				className="secret-field__toggle"
				onClick={() => setVisible((v) => !v)}
				title={visible ? hideLabel : showLabel}
				aria-label={visible ? hideLabel : showLabel}
				aria-pressed={visible}
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					width="15"
					height="15"
					aria-hidden="true"
				>
					<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
					<circle cx="12" cy="12" r="3" />
				</svg>
			</button>
		</div>
	);
}
