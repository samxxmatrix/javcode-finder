import { useState } from "react";
import type { LocaleMessages } from "../../../src/lib/locales";
import type { SupportedLocale } from "../../../src/lib/types";
import type { UpdateCheckInfo } from "./settings/types";
import { useSettingsDraft } from "./settings/useSettingsDraft";
import { SettingsDraftProvider } from "./settings/SettingsDraftContext";
import { BasicSettingsPage } from "./settings/BasicSettingsPage";
import { AdvancedSettingsPage } from "./settings/AdvancedSettingsPage";

/** 版本检查的展示状态；App 持有数据，设置页只渲染 + 触发手动检查 */
export type { UpdateCheckInfo } from "./settings/types";

interface SettingsViewProps {
	locale: SupportedLocale;
	t: LocaleMessages;
	onBack: () => void;
	onLocaleChange?: (locale: SupportedLocale) => void;
	// 云端验证通过（即"开通云端同步"）后回调，由 App 执行首次同步
	onWebdavConnected?: () => void;
	// 「删除收藏」清理完成后回传清理后的收藏列表，由 App 同步主面板状态
	onFavoritesPurged?: (codes: string[]) => void;
	// 版本检查状态：App 是唯一请求方，这里只展示 + 回调手动检查
	updateCheck?: UpdateCheckInfo;
}

type SettingsTab = "basic" | "advanced";

/**
 * 设置页外壳：只负责头部、两页切换与自动保存提示。
 * 全部字段状态收敛在 useSettingsDraft（经 context 注入子页），
 * 没有保存按钮 —— 修改即保存，切页/返回都不会丢输入。
 */
export function SettingsView({
	locale,
	t,
	onBack,
	onLocaleChange,
	onWebdavConnected,
	onFavoritesPurged,
	updateCheck,
}: SettingsViewProps) {
	const draft = useSettingsDraft({
		locale,
		t,
		onLocaleChange,
		onWebdavConnected,
		onFavoritesPurged,
	});
	const [tab, setTab] = useState<SettingsTab>("basic");

	return (
		<SettingsDraftProvider value={draft}>
			<div className="settings-view">
				<div className="settings-view__header">
					<button
						type="button"
						className="settings-view__back-btn"
						onClick={onBack}
						title={t.backToScanner}
					>
						<svg
							className="icon-back"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<polyline points="15 18 9 12 15 6" />
						</svg>
						<span>{t.backToScanner}</span>
					</button>
					<h2 className="settings-view__title">{t.settingsTitle}</h2>
					{/* 自动保存反馈：绝对定位叠在头部右侧，不占布局空间，避免页面抖动 */}
					<p
						className={`settings-view__save-state${
							draft.saveState === "idle" ? "" : " settings-view__save-state--active"
						}`}
						role="status"
						aria-live="polite"
					>
						{draft.saveState === "saving"
							? t.autosaveSaving
							: draft.saveState === "saved"
								? t.autosaveSaved
								: ""}
					</p>
				</div>

				{/* 两段式切换器：侧面板太窄，横滚 tab 会挤压标题，分段控件最稳 */}
				<div className="settings-tabs" role="tablist" aria-label={t.settingsTitle}>
					<button
						type="button"
						role="tab"
						className={`settings-tabs__item${tab === "basic" ? " settings-tabs__item--active" : ""}`}
						aria-selected={tab === "basic"}
						onClick={() => setTab("basic")}
					>
						{t.settingsTabBasic}
					</button>
					<button
						type="button"
						role="tab"
						className={`settings-tabs__item${tab === "advanced" ? " settings-tabs__item--active" : ""}`}
						aria-selected={tab === "advanced"}
						onClick={() => setTab("advanced")}
					>
						{t.settingsTabAdvanced}
					</button>
				</div>

				{tab === "basic" ? (
					<BasicSettingsPage updateCheck={updateCheck} />
				) : (
					<AdvancedSettingsPage />
				)}
			</div>
		</SettingsDraftProvider>
	);
}
