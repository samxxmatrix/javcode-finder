import type { ReactNode } from "react";

/**
 * 问号说明图标：正圆描边内一个问号，悬停/键盘聚焦时用 CSS tooltip
 * 展示说明文案 —— 说明文本不再常驻页面，进阶配置多了也不显乱。
 */
export function InfoTip({ text }: { text: string }) {
	return (
		<span
			className="info-tip"
			tabIndex={0}
			role="note"
			aria-label={text}
			data-tip={text}
		>
			<svg
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				aria-hidden="true"
			>
				<circle cx="8" cy="8" r="6.4" strokeWidth="1.3" />
				<path
					d="M6.3 6.3a1.7 1.7 0 1 1 2.45 1.52c-.55.27-.75.6-.75 1.18v.25"
					strokeWidth="1.3"
					strokeLinecap="round"
				/>
				<circle cx="8" cy="11.3" r="0.85" fill="currentColor" stroke="none" />
			</svg>
		</span>
	);
}

/** 分组卡片：标题在卡片外，卡片体只包字段；meta（如「已配置 2/3」）跟在标题右侧 */
export function SettingsSection({
	title,
	tip,
	meta,
	titleAside,
	children,
}: {
	title: string;
	/** 悬停在标题后问号图标上显示的说明文案 */
	tip?: string;
	meta?: string;
	/** 标题右侧的附属内容（如翻译用量）；紧跟标题文字右侧 */
	titleAside?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<section className="settings-section" aria-label={title}>
			<div className="settings-section__head">
				<h3 className="settings-section__title">{title}</h3>
				{tip && <InfoTip text={tip} />}
				{titleAside}
				{meta && <span className="settings-section__meta">{meta}</span>}
			</div>
			{children ? <div className="settings-section__body">{children}</div> : null}
		</section>
	);
}

/** 苹果风开关：与各服务行右侧的启用开关共用一份实现 */
export function SettingsSwitch({
	checked,
	onChange,
	label,
}: {
	checked: boolean;
	onChange: (checked: boolean) => void;
	label: string;
}) {
	return (
		<label className="settings-field__switch" title={label}>
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				aria-label={label}
			/>
			<span className="settings-field__switch-track" aria-hidden="true" />
		</label>
	);
}

/**
 * 外部服务折叠行：收起时只占一行（状态点 + 名称 + 状态 + 开关），
 * 展开后才露出地址与 Key —— 这是把 6 组输入框从首屏移走的关键。
 */
export function ServiceRow({
	title,
	enabled,
	open,
	onToggleOpen,
	onToggleEnabled,
	enabledLabel,
	stateText,
	notice,
	children,
}: {
	title: string;
	enabled: boolean;
	open: boolean;
	onToggleOpen: () => void;
	onToggleEnabled: (checked: boolean) => void;
	enabledLabel: string;
	/** 右侧状态文案（已启用 / 未启用 / 未配置），由调用方按语言传入 */
	stateText: string;
	/** 行内错误提示：收起时也要可见，否则开关验证失败后看不出原因 */
	notice?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className={`settings-service${open ? " settings-service--open" : ""}`}>
			<div className="settings-service__head">
				<button
					type="button"
					className="settings-service__title"
					onClick={onToggleOpen}
					aria-expanded={open}
				>
					<span
						className={`settings-service__dot${enabled ? " settings-service__dot--on" : ""}`}
						aria-hidden="true"
					/>
					<span className="settings-service__name">{title}</span>
					<span className="settings-service__state">{stateText}</span>
					<svg
						className={`settings-service__chevron${open ? " settings-service__chevron--open" : ""}`}
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<polyline points="9 6 15 12 9 18" />
					</svg>
				</button>
				<SettingsSwitch
					checked={enabled}
					onChange={onToggleEnabled}
					label={enabledLabel}
				/>
			</div>
			{notice && <div className="settings-service__notice">{notice}</div>}
			{open && <div className="settings-service__body">{children}</div>}
		</div>
	);
}

/** 可关闭的行内错误：原来集中在页面顶部，现在贴到出错的字段旁边 */
export function FieldError({
	text,
	onDismiss,
	closeLabel,
}: {
	text: string;
	onDismiss: () => void;
	closeLabel: string;
}) {
	return (
		<div className="settings-field__error settings-field__error--dismissible">
			<span>{text}</span>
			<button
				type="button"
				className="settings-field__error-close"
				onClick={onDismiss}
				title={closeLabel}
				aria-label={closeLabel}
			>
				<svg
					viewBox="0 0 20 20"
					fill="currentColor"
					width="11"
					height="11"
					aria-hidden="true"
				>
					<path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
				</svg>
			</button>
		</div>
	);
}
