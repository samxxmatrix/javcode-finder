import { isPlatformConfigured } from "../../../../src/lib/settings";
import { ClearButton } from "../ClearButton";
import { useDraft } from "./SettingsDraftContext";

/**
 * 平台跳转的单个配置组：名称 + 链接规则。
 * 组标题跟着名称输入实时变；名称为空时退回固定槽位标题（平台 1 / 2 / 3），
 * 免得三组共六个输入框连成一片、分不清哪个链接属于哪个平台。
 */
export function PlatformGroup({
	index,
	idPrefix,
	name,
	template,
	onNameChange,
	onTemplateChange,
}: {
	/** 固定槽位序号，从 1 起；仅用于名称为空时的占位标题 */
	index: number;
	/** 两个输入框的 id 前缀，保证 label 的 htmlFor 不撞车 */
	idPrefix: string;
	name: string;
	template: string;
	onNameChange: (value: string) => void;
	onTemplateChange: (value: string) => void;
}) {
	const { t } = useDraft();
	const trimmedName = name.trim();
	const title = trimmedName || t.platformGroupFallback(index);
	// 与 configuredPlatforms 用同一判据，避免状态点和面板按钮的生效范围不一致
	const configured = isPlatformConfigured(name, template);

	return (
		<div className="platform-group" role="group" aria-label={title}>
			<div className="platform-group__head">
				<div
					className={`platform-group__title${trimmedName ? "" : " platform-group__title--placeholder"}`}
					aria-hidden="true"
				>
					{title}
				</div>
				<span className="platform-group__state">
					<span
						className={`platform-group__dot${configured ? " platform-group__dot--on" : ""}`}
						aria-hidden="true"
					/>
					{configured ? t.platformConfigured : t.platformNotConfigured}
				</span>
			</div>

			<div className="settings-field">
				<label className="settings-field__label" htmlFor={`${idPrefix}-name`}>
					{t.platformFieldNameLabel}
				</label>
				<div className="settings-field__input-wrap">
					<input
						id={`${idPrefix}-name`}
						type="text"
						className="settings-field__input"
						value={name}
						onChange={(e) => onNameChange(e.target.value)}
						placeholder={t.platformFieldNameLabel}
						spellCheck={false}
						autoComplete="off"
					/>
					<ClearButton
						show={Boolean(name)}
						onClick={() => onNameChange("")}
						title={t.clearInput}
					/>
				</div>
			</div>

			<div className="settings-field">
				<label className="settings-field__label" htmlFor={`${idPrefix}-template`}>
					{t.platformFieldUrlLabel}
				</label>
				<div className="settings-field__input-wrap">
					<input
						id={`${idPrefix}-template`}
						type="text"
						className="settings-field__input"
						value={template}
						onChange={(e) => onTemplateChange(e.target.value)}
						placeholder="https://example.com/search?q={code}"
						spellCheck={false}
						autoComplete="off"
					/>
					<ClearButton
						show={Boolean(template)}
						onClick={() => onTemplateChange("")}
						title={t.clearInput}
					/>
				</div>
			</div>
		</div>
	);
}
