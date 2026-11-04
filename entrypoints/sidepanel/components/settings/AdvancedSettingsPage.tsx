import { useState } from "react";
import { DEFAULT_CODE_REGEX } from "../../../../src/lib/settings";
import {
	formatUsage,
	shouldShowUsage,
} from "../../../../src/lib/translate";
import { ClearButton } from "../ClearButton";
import {
	FieldError,
	InfoTip,
	ServiceRow,
	SettingsSection,
	SettingsSwitch,
} from "./SettingsSection";
import { useDraft } from "./SettingsDraftContext";

/**
 * 进阶设置页：全部是需要外部服务或正则表达式的配置。
 * 数据源与云盘统一收成折叠行 —— 收起时只占一行，展开才露出地址与密钥。
 */
export function AdvancedSettingsPage() {
	const d = useDraft();
	const { t } = d;

	const [lookupOpen, setLookupOpen] = useState(false);
	const [embyOpen, setEmbyOpen] = useState(false);
	const [translateOpen, setTranslateOpen] = useState(false);
	const [webdavOpen, setWebdavOpen] = useState(false);

	const lookupConfigured = Boolean(d.apiUrl.trim() && d.apiKey.trim());
	const embyConfigured = Boolean(d.embyUrl.trim() && d.embyApiKey.trim());
	const translateConfigured = Boolean(
		d.translateUrl.trim() && d.deeplApiKey.trim(),
	);

	// 校验期间统一显示「连接中」：开关同时被禁用，用户不会重复点击
	const stateText = (enabled: boolean, configured: boolean, busy = false) =>
		busy
			? t.statusConnecting
			: enabled
				? t.statusEnabled
				: configured
					? t.statusConfiguredOff
					: t.statusNotConfigured;

	const configuredCount = [lookupConfigured, embyConfigured].filter(
		Boolean,
	).length;

	return (
		<div className="settings-page">
			<SettingsSection
				title={t.settingsGroupSources}
				meta={t.configuredCount(configuredCount, 2)}
			>
				<ServiceRow
					title={t.lookupSourceLabel}
					enabled={d.lookupEnabled}
					busy={d.lookupVerifying}
					open={lookupOpen}
					onToggleOpen={() => setLookupOpen((v) => !v)}
					onToggleEnabled={(checked) => void d.handleToggleLookup(checked)}
					enabledLabel={t.lookupEnableLabel}
					stateText={stateText(
						d.lookupEnabled,
						lookupConfigured,
						d.lookupVerifying,
					)}
					notice={
						d.lookupVerifyError ? (
							<FieldError
								text={d.lookupVerifyError}
								onDismiss={() => d.setLookupVerifyError(null)}
								closeLabel={t.closeError}
							/>
						) : undefined
					}
				>
					<div className="settings-field">
						<label className="settings-field__label" htmlFor="api-url">
							{t.apiUrlLabel}
						</label>
						<div className="settings-field__input-wrap">
							<input
								id="api-url"
								type="text"
								className="settings-field__input settings-field__input--code"
								value={d.apiUrl}
								onChange={(e) => d.setApiUrl(e.target.value)}
								placeholder="https://your-proxy.vercel.app"
								spellCheck={false}
								autoComplete="off"
							/>
							<ClearButton
								show={Boolean(d.apiUrl)}
								onClick={() => d.setApiUrl("")}
								title={t.clearInput}
							/>
						</div>
					</div>
					<div className="settings-field">
						<label className="settings-field__label" htmlFor="api-key">
							{t.apiKeyLabel}
						</label>
						<div className="settings-field__input-wrap">
							<input
								id="api-key"
								type="text"
								className="settings-field__input settings-field__input--code"
								value={d.apiKey}
								onChange={(e) => d.setApiKey(e.target.value)}
								placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
								spellCheck={false}
								autoComplete="off"
							/>
							<ClearButton
								show={Boolean(d.apiKey)}
								onClick={() => d.setApiKey("")}
								title={t.clearInput}
							/>
						</div>
					</div>
				</ServiceRow>

				<ServiceRow
					title={t.embySourceLabel}
					enabled={d.embyEnabled}
					busy={d.embyVerifying}
					open={embyOpen}
					onToggleOpen={() => setEmbyOpen((v) => !v)}
					onToggleEnabled={(checked) => void d.handleToggleEmby(checked)}
					enabledLabel={t.embyEnableLabel}
					stateText={stateText(d.embyEnabled, embyConfigured, d.embyVerifying)}
					notice={
						d.embyVerifyError ? (
							<FieldError
								text={d.embyVerifyError}
								onDismiss={() => d.setEmbyVerifyError(null)}
								closeLabel={t.closeError}
							/>
						) : undefined
					}
				>
					<div className="settings-field">
						<label className="settings-field__label" htmlFor="emby-url">
							{t.embyUrlLabel}
						</label>
						<div className="settings-field__input-wrap">
							<input
								id="emby-url"
								type="text"
								className="settings-field__input settings-field__input--code"
								value={d.embyUrl}
								onChange={(e) => {
									d.setEmbyUrl(e.target.value);
									// 超额提示是会话内状态，换地址/Key 后旧提示已失效
									d.setEmbyTooLarge(false);
								}}
								placeholder="http://127.0.0.1:8096"
								spellCheck={false}
								autoComplete="off"
							/>
							<ClearButton
								show={Boolean(d.embyUrl)}
								onClick={() => d.setEmbyUrl("")}
								title={t.clearInput}
							/>
						</div>
					</div>
					<div className="settings-field">
						<div className="settings-field__header-row">
							<label className="settings-field__label" htmlFor="emby-api-key">
								{t.embyApiKeyLabel}
							</label>
							{d.embyIndexInfo.syncedAt !== null && (
								<span className="settings-field__hint settings-field__hint--end">
									{t.embyItemCountLabel(d.embyIndexInfo.total)}
								</span>
							)}
						</div>
						<div className="settings-field__input-wrap">
							<input
								id="emby-api-key"
								type="text"
								className="settings-field__input settings-field__input--code"
								value={d.embyApiKey}
								onChange={(e) => {
									d.setEmbyApiKey(e.target.value);
									// 同上：改 Key 等于换了服务器，超额提示一并清理
									d.setEmbyTooLarge(false);
								}}
								placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
								spellCheck={false}
								autoComplete="off"
							/>
							<ClearButton
								show={Boolean(d.embyApiKey)}
								onClick={() => d.setEmbyApiKey("")}
								title={t.clearInput}
							/>
						</div>
					</div>
					<div className="settings-field">
						<div className="settings-field__header-row">
							<span className="settings-field__label">
								{d.embyIndexInfo.syncedAt
									? t.embySyncedAtLabel(
											new Date(d.embyIndexInfo.syncedAt).toLocaleString(),
										)
									: t.embyNotSynced}
							</span>
							<button
								type="button"
								className="popup-btn popup-btn--secondary"
								onClick={() => void d.handleEmbySyncNow()}
							>
								{t.embySyncNow}
							</button>
						</div>
						{d.embyTooLarge && (
							<p className="settings-field__hint">{t.embyTooLarge}</p>
						)}
					</div>
				</ServiceRow>
			</SettingsSection>

			<SettingsSection
				title={t.settingsGroupTranslateService}
				tip={t.translatePriorityDesc}
				titleAside={
					/* 仅开关启用时显示用量区；按优先级：离线 → 加载中 → 数字 → 不显示 */
					d.translateEnabled
						? d.translateOffline
							? (
								<span className="settings-section__usage settings-section__usage--offline">
									{t.translateServiceOffline}
								</span>
							)
							: d.translateUsageLoading
								? (
									<span className="settings-section__usage settings-section__usage--loading">
										{t.translateUsageLoading}
									</span>
								)
								: shouldShowUsage(d.translateEnabled, d.translateUsage)
									? (
										<span className="settings-section__usage">
											{formatUsage(
												d.translateUsage.count,
												d.translateUsage.limit,
												d.locale,
											)}
										</span>
									)
									: null
						: null
				}
			>
			<ServiceRow
				title={t.translateServiceLabel}
				enabled={d.translateEnabled}
				busy={d.translateVerifying}
				open={translateOpen}
				onToggleOpen={() => setTranslateOpen((v) => !v)}
				onToggleEnabled={(checked) => void d.handleToggleTranslate(checked)}
				enabledLabel={t.translateEnableLabel}
				stateText={stateText(
					d.translateEnabled,
					translateConfigured,
					d.translateVerifying,
				)}
				notice={
					d.translateVerifyError ? (
						<FieldError
							text={d.translateVerifyError}
							onDismiss={() => d.setTranslateVerifyError(null)}
							closeLabel={t.closeError}
						/>
					) : undefined
				}
			>
					<div className="settings-field">
						<label className="settings-field__label" htmlFor="translate-url">
							{t.translateUrlLabel}
						</label>
						<div className="settings-field__input-wrap">
							<input
								id="translate-url"
								type="text"
								className="settings-field__input settings-field__input--code"
								value={d.translateUrl}
								onChange={(e) => d.setTranslateUrl(e.target.value)}
								placeholder="https://example.com/"
								spellCheck={false}
								autoComplete="off"
							/>
							<ClearButton
								show={Boolean(d.translateUrl)}
								onClick={() => d.setTranslateUrl("")}
								title={t.clearInput}
							/>
						</div>
					</div>
					<div className="settings-field">
						<div className="settings-field__header-row">
							<label className="settings-field__label" htmlFor="deepl-key">
								{t.deeplApiKeyLabel}
							</label>
						</div>
						<div className="settings-field__input-wrap">
							<input
								id="deepl-key"
								type="text"
								className="settings-field__input settings-field__input--code"
								value={d.deeplApiKey}
								onChange={(e) => d.setDeeplApiKey(e.target.value)}
								placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
								spellCheck={false}
								autoComplete="off"
							/>
							<ClearButton
								show={Boolean(d.deeplApiKey)}
								onClick={() => d.setDeeplApiKey("")}
								title={t.clearInput}
							/>
						</div>
					</div>
				</ServiceRow>
			</SettingsSection>

			<SettingsSection
				title={t.settingsGroupCodeRules}
				titleAside={
					<button
						type="button"
						className="settings-field__reset-link settings-section__aside"
						onClick={d.handleResetRegex}
					>
						{t.resetRegex}
					</button>
				}
			>
				{/* 番号识别正则：与番号排除正则同组（原在基础页） */}
				<div className="settings-field">
					<div className="settings-field__input-wrap">
						<input
							id="custom-regex"
							type="text"
							className={`settings-field__input settings-field__input--code ${
								d.regexError ? "settings-field__input--error" : ""
							}`}
							value={d.customRegex}
							onChange={(e) => d.handleRegexChange(e.target.value)}
							placeholder={DEFAULT_CODE_REGEX}
							spellCheck={false}
							autoComplete="off"
						/>
						<ClearButton
							show={Boolean(d.customRegex)}
							onClick={() => d.handleRegexChange("")}
							title={t.clearInput}
						/>
					</div>
				</div>

				<div className="settings-field">
					<div className="settings-field__header-row settings-field__header-row--start">
						<label
							className="settings-field__label"
							htmlFor="code-exclude-regex"
						>
							{t.codeExcludeRegexLabel}
						</label>
						<InfoTip text={t.codeExcludeRegexDesc} />
					</div>
					<div className="settings-field__input-wrap">
						<input
							id="code-exclude-regex"
							type="text"
							className={`settings-field__input settings-field__input--code ${
								d.codeExcludeRegexError ? "settings-field__input--error" : ""
							}`}
							value={d.codeExcludeRegex}
							onChange={(e) => d.handleCodeExcludeRegexChange(e.target.value)}
							placeholder="HEYZO|3dw"
							spellCheck={false}
							autoComplete="off"
						/>
						<ClearButton
							show={Boolean(d.codeExcludeRegex)}
							onClick={() => d.handleCodeExcludeRegexChange("")}
							title={t.clearInput}
						/>
					</div>
				</div>

				<div className="settings-field">
					<div className="settings-field__header-row settings-field__header-row--start">
						<label className="settings-field__label">
							{t.falenoPrefixesLabel}
						</label>
						<InfoTip text={t.falenoPrefixesDesc} />
					</div>
					{d.falenoPrefixes.length > 0 && (
						<div className="excluded-hosts-list">
							{d.falenoPrefixes.map((prefix) => (
								<span key={prefix} className="excluded-host-chip">
									<span className="excluded-host-chip__name">{prefix}</span>
									<button
										type="button"
										className="excluded-host-chip__remove"
										onClick={() => d.handleRemovePrefix(prefix)}
										title={`${t.removeSite}: ${prefix}`}
										aria-label={`${t.removeSite}: ${prefix}`}
									>
										&times;
									</button>
								</span>
							))}
						</div>
					)}
					<div className="excluded-hosts-add-row">
						<div className="settings-field__input-wrap">
							<input
								type="text"
								className="settings-field__input excluded-hosts-input"
								value={d.newPrefixInput}
								onChange={(e) => d.setNewPrefixInput(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										d.handleAddPrefix();
									}
								}}
								placeholder={t.falenoPrefixPlaceholder}
								spellCheck={false}
								autoComplete="off"
							/>
							<ClearButton
								show={Boolean(d.newPrefixInput)}
								onClick={() => d.setNewPrefixInput("")}
								title={t.clearInput}
							/>
						</div>
						<button
							type="button"
							className="popup-btn popup-btn--secondary excluded-hosts-add-btn"
							onClick={d.handleAddPrefix}
						>
							{t.addSite}
						</button>
					</div>
				</div>
			</SettingsSection>

			<SettingsSection title={t.settingsGroupSync} tip={t.cloudSyncDesc}>
				<ServiceRow
					title={t.cloudSyncLabel}
					enabled={d.webdavEnabled}
					open={webdavOpen}
					onToggleOpen={() => setWebdavOpen((v) => !v)}
					onToggleEnabled={(checked) => void d.handleToggleWebdav(checked)}
					enabledLabel={t.cloudSyncLabel}
					stateText={stateText(
						d.webdavEnabled,
						Boolean(d.webdavUrl.trim() && d.webdavUser.trim()),
					)}
					notice={
						d.webdavError ? (
							<FieldError
								text={d.webdavError}
								onDismiss={() => d.setWebdavError(null)}
								closeLabel={t.closeError}
							/>
						) : undefined
					}
				>
					<div className="settings-field__input-wrap">
						<input
							id="webdav-url"
							type="text"
							className="settings-field__input settings-field__input--code"
							value={d.webdavUrl}
							onChange={(e) => d.setWebdavUrl(e.target.value)}
							placeholder={t.webdavUrlPlaceholder}
							spellCheck={false}
							autoComplete="off"
						/>
						<ClearButton
							show={Boolean(d.webdavUrl)}
							onClick={() => d.setWebdavUrl("")}
							title={t.clearInput}
						/>
					</div>
					<div className="settings-field__input-wrap">
						<input
							id="webdav-user"
							type="text"
							className="settings-field__input"
							value={d.webdavUser}
							onChange={(e) => d.setWebdavUser(e.target.value)}
							placeholder={t.webdavUserPlaceholder}
							spellCheck={false}
							autoComplete="off"
						/>
						<ClearButton
							show={Boolean(d.webdavUser)}
							onClick={() => d.setWebdavUser("")}
							title={t.clearInput}
						/>
					</div>
					<div className="webdav-pass-row">
						<div className="settings-field__input-wrap">
							<input
								id="webdav-pass"
								type={d.showPass ? "text" : "password"}
								className="settings-field__input"
								value={d.webdavPass}
								onChange={(e) => d.setWebdavPass(e.target.value)}
								placeholder={t.webdavPassPlaceholder}
								autoComplete="off"
							/>
							<ClearButton
								show={Boolean(d.webdavPass)}
								onClick={() => d.setWebdavPass("")}
								title={t.clearInput}
							/>
						</div>
						<button
							type="button"
							className="webdav-pass-toggle"
							onClick={() => d.setShowPass(!d.showPass)}
							title={d.showPass ? t.hidePassword : t.showPassword}
							aria-label={d.showPass ? t.hidePassword : t.showPassword}
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

					{/* 参数已填但开关没开：给一个就地的一键入口，省得用户回到行首找开关 */}
					{!d.webdavEnabled && d.webdavUrl.trim() && d.webdavUser.trim() && (
						<button
							type="button"
							className="popup-btn popup-btn--primary cloud-enable-btn"
							onClick={() => void d.handleToggleWebdav(true)}
						>
							{t.cloudEnableAndUpload}
						</button>
					)}

					{d.cloudStatus && (
						<p
							className={`cloud-status${
								d.cloudStatus.ok ? "" : " cloud-status--error"
							}`}
							role="status"
							aria-live="polite"
						>
							{d.cloudStatus.text}
						</p>
					)}

					{/* 云端已有配置且本地已自定义：由用户决定恢复还是覆盖，绝不静默覆盖任何一侧 */}
					{d.cloudConflict && (
						<div className="cloud-conflict" role="group">
							<p className="cloud-conflict__text">
								{t.cloudSettingsFound(
									d.cloudConflict.updatedAt
										? new Date(d.cloudConflict.updatedAt).toLocaleString()
										: undefined,
								)}
							</p>
							<div className="cloud-conflict__actions">
								<button
									type="button"
									className="popup-btn popup-btn--primary"
									onClick={() => d.applyCloudSettings(d.cloudConflict!)}
								>
									{t.cloudRestoreFromCloud}
								</button>
								<button
									type="button"
									className="popup-btn popup-btn--secondary"
									onClick={() => void d.handleOverwriteCloud()}
								>
									{t.cloudOverwriteCloud}
								</button>
							</div>
						</div>
					)}
				</ServiceRow>
			</SettingsSection>

			<SettingsSection
				title={t.settingsGroupDanger}
				tip={t.resetDefaultsDesc}
				titleAside={
					<button
						type="button"
						className="settings-field__reset-link settings-section__aside"
						onClick={() => {
							// 没有保存按钮兜底，恢复默认必须二次确认
							if (window.confirm(t.resetConfirm)) d.handleReset();
						}}
					>
						{t.resetDefaults}
					</button>
				}
			>
			</SettingsSection>
		</div>
	);
}
