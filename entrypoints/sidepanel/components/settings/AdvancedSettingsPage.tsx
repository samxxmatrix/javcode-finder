import { useEffect, useRef, useState } from "react";
import { DEFAULT_CODE_REGEX } from "../../../../src/lib/settings";
import { ClearButton } from "../ClearButton";
import { ConfirmDialog } from "./ConfirmDialog";
import { SecretField } from "./SecretField";
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
	// 恢复默认确认弹窗
	const [confirmReset, setConfirmReset] = useState(false);
	// 模型下拉（自定义 combobox）：输入 ≥3 字符时模糊过滤，否则列出全部
	const [modelsOpen, setModelsOpen] = useState(false);
	const modelSelectRef = useRef<HTMLDivElement>(null);
	// 下拉搜索关键词：独立于 translateModel，避免搜索词被当成模型名落盘
	const [searchQuery, setSearchQuery] = useState("");
	// 手填模型名不在候选中时的待确认模型名
	const [confirmModel, setConfirmModel] = useState<string | null>(null);

	// 面板外点击或 Esc 收起；箭头按钮在 ref 内，不会被自己的 pointerdown 关掉
	useEffect(() => {
		if (!modelsOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!modelSelectRef.current?.contains(event.target as Node)) {
				setModelsOpen(false);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [modelsOpen]);

	// 模型可用性测试通过后：把 pending 模型名写入 translateModel（触发自动保存落盘），
	// 清空待确认态与搜索词，关闭确认弹窗；出错时保留 confirmModel 供重试。
	useEffect(() => {
		if (d.translateTestStatus !== "success" || !d.pendingTranslateModel)
			return;
		d.setTranslateModel(d.pendingTranslateModel);
		d.setPendingTranslateModel(null);
		setConfirmModel(null);
		setSearchQuery("");
		setModelsOpen(false);
	}, [d.translateTestStatus, d.pendingTranslateModel, d]);

	const lookupConfigured = Boolean(d.apiUrl.trim() && d.apiKey.trim());
	const embyConfigured = Boolean(d.embyUrl.trim() && d.embyApiKey.trim());
	const translateConfigured = Boolean(
		d.translateUrl.trim() && d.translateApiKey.trim(),
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

	// 搜索关键词 ≥3 字符时启动模糊匹配；匹配项置顶显示，其余保留在下方
	const modelQuery = searchQuery.trim().toLowerCase();
	const matchedModels =
		modelQuery.length >= 3
			? d.translateModels.filter((m) => m.toLowerCase().includes(modelQuery))
			: [];
	const otherModels = d.translateModels.filter(
		(m) => !matchedModels.includes(m),
	);
	const hasSearch = modelQuery.length >= 3;

	return (
		<div className="settings-page">
			{confirmReset && (
				<div className="confirm-overlay" role="dialog" aria-modal="true">
					<div className="confirm-dialog">
						<p className="confirm-dialog__text">{t.resetConfirm}</p>
						<div className="confirm-dialog__actions">
							<button
								type="button"
								className="popup-btn popup-btn--secondary"
								onClick={() => setConfirmReset(false)}
							>
								{t.cancel}
							</button>
							<button
								type="button"
								className="popup-btn popup-btn--danger"
								onClick={() => {
									d.handleReset();
									setConfirmReset(false);
								}}
							>
								{t.confirm}
							</button>
						</div>
					</div>
				</div>
			)}
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
						<SecretField
							id="api-key"
							value={d.apiKey}
							onChange={(v) => d.setApiKey(v)}
							onClear={() => d.setApiKey("")}
							placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
							code
							clearLabel={t.clearInput}
							showLabel={t.showPassword}
							hideLabel={t.hidePassword}
						/>
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
						{/* 索引条数跟在地址这行：它是「这台服务器索引了多少」的归属信息 */}
						<div className="settings-field__header-row">
							<label className="settings-field__label" htmlFor="emby-url">
								{t.embyUrlLabel}
							</label>
							{d.embyIndexInfo.syncedAt !== null && (
								<span className="settings-field__hint settings-field__hint--end">
									{t.embyItemCountLabel(d.embyIndexInfo.total)}
								</span>
							)}
						</div>
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
						<label className="settings-field__label" htmlFor="emby-api-key">
							{t.embyApiKeyLabel}
						</label>
						<SecretField
							id="emby-api-key"
							value={d.embyApiKey}
							onChange={(v) => {
								d.setEmbyApiKey(v);
								// 同上：改 Key 等于换了服务器，超额提示一并清理
								d.setEmbyTooLarge(false);
							}}
							onClear={() => d.setEmbyApiKey("")}
							placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
							code
							clearLabel={t.clearInput}
							showLabel={t.showPassword}
							hideLabel={t.hidePassword}
						/>
					</div>
					{/*
						删除收藏：不是隐藏图标，而是真实删掉「已在 Emby 库中」的收藏。
						因此开关只是入口 —— 有可删项时先展开展示确认区，确认后才落盘并打开。
					*/}
					<div className="settings-field">
						<div className="settings-field__header-row">
							<span className="settings-field__label-group">
								<span className="settings-field__label">
									{t.embyDropFavoritesLabel}
								</span>
								<InfoTip text={t.embyDropFavoritesTip} />
							</span>
							<SettingsSwitch
								checked={d.embyDropFavorites}
								onChange={(checked) => void d.handleToggleEmbyDropFavorites(checked)}
								label={t.embyDropFavoritesLabel}
								disabled={d.dropFavoritesSyncing}
							/>
						</div>
						{d.dropFavoritesConfirm !== null && (
							<div className="cloud-conflict" role="group">
								<p className="cloud-conflict__text">
									{t.embyDropFavoritesConfirm(d.dropFavoritesConfirm)}
								</p>
								<div className="cloud-conflict__actions">
									<button
										type="button"
										className="popup-btn popup-btn--danger"
										onClick={() => void d.handleConfirmDropFavorites()}
									>
										{t.embyDropFavoritesConfirmOk}
									</button>
									<button
										type="button"
										className="popup-btn popup-btn--secondary"
										onClick={d.handleCancelDropFavorites}
									>
										{t.embyDropFavoritesCancel}
									</button>
								</div>
							</div>
						)}
						{/* 打开前强制同步一次索引：期间开关置灰，避免重复点击叠出并发同步 */}
						{d.dropFavoritesSyncing && (
							<p className="settings-field__hint" role="status" aria-live="polite">
								{t.embyDropFavoritesSyncing}
							</p>
						)}
						{d.dropFavoritesNotice && (
							<p className="settings-field__hint" role="status" aria-live="polite">
								{d.dropFavoritesNotice}
							</p>
						)}
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
							<label className="settings-field__label" htmlFor="translate-key">
								{t.translateApiKeyLabel}
							</label>
						</div>
						<SecretField
							id="translate-key"
							value={d.translateApiKey}
							onChange={(v) => d.setTranslateApiKey(v)}
							onClear={() => d.setTranslateApiKey("")}
							placeholder="sk-..."
							code
							clearLabel={t.clearInput}
							showLabel={t.showPassword}
							hideLabel={t.hidePassword}
						/>
					</div>
					<div className="settings-field">
						<div className="settings-field__header-row">
							<label className="settings-field__label" htmlFor="translate-model">
								{t.translateModelLabel}
							</label>
							<button
								type="button"
								className="settings-field__reset-link settings-section__aside"
								onClick={() => {
									// 展开下拉：成功填列表、失败填错误信息，都在选择区里可见
									setModelsOpen(true);
									void d.refreshTranslateModels();
								}}
								disabled={!translateConfigured || d.translateModelsLoading}
								title={t.translateModelsRefresh}
							>
								{t.translateModelsRefresh}
							</button>
						</div>
						<div
							className="settings-model-select"
							ref={modelSelectRef}
							onKeyDown={(e) => {
								if (e.key === "Escape") setModelsOpen(false);
							}}
						>
							<div className="settings-field__input-wrap">
								<input
									id="translate-model"
									type="text"
									className={`settings-field__input settings-field__input--code${
										!searchQuery.trim() &&
										d.translateModel &&
										d.translateModel === d.verifiedTranslateModel
											? " is-verified"
											: ""
									}`}
									value={searchQuery}
									onChange={(e) => {
										setSearchQuery(e.target.value);
										// 输入时自动展开下拉，便于边搜边选
										if (e.target.value.trim()) setModelsOpen(true);
									}}
									placeholder={
										d.translateModel ||
										d.pendingTranslateModel ||
										t.translateModelPlaceholder
									}
									spellCheck={false}
									autoComplete="off"
									role="combobox"
									aria-expanded={modelsOpen}
									aria-controls="translate-model-menu"
								/>
								<ClearButton
									show={Boolean(searchQuery.trim())}
									onClick={() => {
										setSearchQuery("");
										setConfirmModel(null);
									}}
									title={t.clearInput}
								/>
								<button
									type="button"
									className="settings-model-select__toggle"
									onClick={() => setModelsOpen((v) => !v)}
									aria-label={t.translateModelLabel}
									aria-expanded={modelsOpen}
									aria-controls="translate-model-menu"
								>
									<span aria-hidden="true">▾</span>
								</button>
							</div>
							{d.translateTestStatus === "testing" ? (
								<span className="settings-model-select__test-status">
									测试中…
								</span>
							) : d.translateTestStatus === "success" ? (
								<span className="settings-model-select__test-status settings-model-select__test-status--success">
									测试成功
								</span>
							) : (
								<button
									type="button"
									className="settings-model-select__test"
									disabled={
										!translateConfigured ||
										!(
											searchQuery.trim() ||
											d.translateModel ||
											d.pendingTranslateModel
										)
									}
									onClick={() => {
										const input =
											(searchQuery.trim() ||
												d.translateModel ||
												d.pendingTranslateModel) ?? "";
										if (!input) return;
										if (d.translateModels.includes(input)) {
											// 已在候选列表中：直接测试，无需确认
											void d.testTranslateModel(input);
										} else {
											// 不在候选列表中：先弹确认框
											setConfirmModel(input);
										}
									}}
									title="测试模型是否可用"
								>
									测试
								</button>
							)}
							{modelsOpen && (
								<div
									id="translate-model-menu"
									className="settings-model-select__menu"
									role="listbox"
								>
									{d.translateModelsError ? (
										<p className="settings-model-select__error">
											{d.translateModelsError}
										</p>
									) : d.translateModelsLoading ? (
										<p className="settings-model-select__empty">
											{t.translateModelsLoading}
										</p>
									) : hasSearch && matchedModels.length === 0 &&
										d.translateModels.length > 0 ? (
										<p className="settings-model-select__empty">
											{t.translateModelsNoMatch}
										</p>
									) : (
										<>
											{matchedModels.map((m) => (
												<button
													key={m}
													type="button"
													role="option"
													aria-selected={
														d.translateModel === m ||
														d.pendingTranslateModel === m
													}
													className={`settings-model-select__option${
														d.translateModel === m ||
														d.pendingTranslateModel === m
															? " is-selected"
															: ""
													} ${
														matchedModels.length > 0 &&
														otherModels.length > 0
															? " is-match"
															: ""
													}`}
													onClick={() => {
														d.setTranslateModel(m);
														d.setPendingTranslateModel(null);
														setSearchQuery("");
														setConfirmModel(null);
														setModelsOpen(false);
													}}
												>
													{m}
												</button>
											))}
											{matchedModels.length > 0 &&
												otherModels.length > 0 && (
													<div
														role="separator"
														aria-hidden="true"
														className="settings-model-select__separator"
														style={{
															pointerEvents: "none",
															userSelect: "none",
														}}
													/>
												)}
											{otherModels.map((m) => (
												<button
													key={m}
													type="button"
													role="option"
													aria-selected={
														d.translateModel === m ||
														d.pendingTranslateModel === m
													}
													className={`settings-model-select__option${
														d.translateModel === m ||
														d.pendingTranslateModel === m
															? " is-selected"
															: ""
													}`}
													onClick={() => {
														d.setTranslateModel(m);
														d.setPendingTranslateModel(null);
														setSearchQuery("");
														setConfirmModel(null);
														setModelsOpen(false);
													}}
												>
													{m}
												</button>
											))}
										</>
									)}
								</div>
							)}
						</div>
						{d.translateTestStatus === "error" && d.translateTestMessage && (
							<FieldError
								text={`连接失败：${d.translateTestMessage}`}
								onDismiss={() => {
									d.setTranslateTestStatus("idle");
									d.setTranslateTestMessage(null);
								}}
								closeLabel={t.closeError}
							/>
						)}
						{confirmModel && (
							<ConfirmDialog
								open
								title={
									`"${confirmModel}" 不在候选模型中，请确认是否使用该模型？`
								}
								confirmLabel="测试"
								cancelLabel="取消"
								confirmVariant="primary"
								onConfirm={() => {
									setConfirmModel(null);
									void d.testTranslateModel(confirmModel);
								}}
								onCancel={() => setConfirmModel(null)}
							/>
						)}
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
					<SecretField
						id="webdav-pass"
						value={d.webdavPass}
						onChange={(v) => d.setWebdavPass(v)}
						onClear={() => d.setWebdavPass("")}
						placeholder={t.webdavPassPlaceholder}
						clearLabel={t.clearInput}
						showLabel={t.showPassword}
						hideLabel={t.hidePassword}
					/>

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
						onClick={() => setConfirmReset(true)}
					>
						{t.resetDefaults}
					</button>
				}
			>
			</SettingsSection>
		</div>
	);
}
