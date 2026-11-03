import { useState } from "react";
import { ClearButton } from "../ClearButton";
import { SettingsSection } from "./SettingsSection";
import { useDraft } from "./SettingsDraftContext";
import type { UpdateCheckInfo } from "./types";

/**
 * 基础设置页：不需要任何密钥就能用的字段。
 * 顺序按确认过的产品顺序：界面 -> 基础翻译 -> 排除站点 -> 跳转与识别 -> 版本与更新（底部）。
 * 番号识别正则与番号排除正则统一放在进阶页的「番号规则」分组。
 */
export function BasicSettingsPage({
	updateCheck,
}: {
	updateCheck?: UpdateCheckInfo;
}) {
	const d = useDraft();
	const { t } = d;
	const [jumpOpen, setJumpOpen] = useState(false);

	return (
		<div className="settings-page">


			<SettingsSection title={t.settingsGroupInterface}>
				<div className="settings-field">
					<label className="settings-field__label" htmlFor="locale-select">
						{t.languageLabel}
					</label>
					<select
						id="locale-select"
						className="settings-field__select"
						value={d.localeOption}
						onChange={(e) =>
							d.handleLocaleSelect(e.target.value as Parameters<typeof d.handleLocaleSelect>[0])
						}
					>
						<option value="auto">{t.languageAuto}</option>
						<option value="zh-hans">简体中文</option>
						<option value="zh-hant">繁體中文</option>
						<option value="en">English</option>
					</select>
				</div>

				<div className="settings-field">
					<label className="settings-field__label" htmlFor="preview-volume">
						{t.previewVolumeLabel}
					</label>
					<div className="settings-field__volume-row">
						<input
							id="preview-volume"
							type="range"
							className="settings-field__range"
							min={0}
							max={100}
							step={1}
							value={d.previewVolume}
							onChange={(e) => d.setPreviewVolume(Number(e.target.value))}
						/>
						<span className="settings-field__volume-value">
							{d.previewVolume}%
						</span>
					</div>
				</div>
			</SettingsSection>

			<SettingsSection title={t.settingsGroupBasicTranslate} tip={t.basicTranslateDesc}>
				<div className="settings-field">
					<div
						className="settings-field__segment"
						role="group"
						aria-label={t.fallbackServiceLabel}
					>
						<button
							type="button"
							className="settings-field__segment-btn"
							aria-pressed={d.fallbackService === "google"}
							onClick={() => d.setFallbackService("google")}
						>
							{t.fallbackGoogle}
						</button>
						<button
							type="button"
							className="settings-field__segment-btn"
							aria-pressed={d.fallbackService === "bing"}
							onClick={() => d.setFallbackService("bing")}
						>
							{t.fallbackBing}
						</button>
					</div>
				</div>
			</SettingsSection>

			<SettingsSection title={t.excludedSitesLabel} tip={t.excludedSitesDesc}>
				<div className="settings-field">
					{d.excludedHosts.length > 0 && (
						<div className="excluded-hosts-list">
							{d.excludedHosts.map((host) => (
								<span key={host} className="excluded-host-chip">
									<span className="excluded-host-chip__name">{host}</span>
									<button
										type="button"
										className="excluded-host-chip__remove"
										onClick={() => d.handleRemoveHost(host)}
										title={`${t.removeSite}: ${host}`}
										aria-label={`${t.removeSite}: ${host}`}
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
								value={d.newHostInput}
								onChange={(e) => d.setNewHostInput(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										d.handleAddHost();
									}
								}}
								placeholder={t.sitePlaceholder}
								spellCheck={false}
								autoComplete="off"
							/>
							<ClearButton
								show={Boolean(d.newHostInput)}
								onClick={() => d.setNewHostInput("")}
								title={t.clearInput}
							/>
						</div>
						<button
							type="button"
							className="popup-btn popup-btn--secondary excluded-hosts-add-btn"
							onClick={d.handleAddHost}
						>
							{t.addSite}
						</button>
					</div>
				</div>
			</SettingsSection>

			<SettingsSection title={t.settingsGroupJump} tip={t.settingsDesc}>
				<button
					type="button"
					className="settings-disclosure"
					onClick={() => setJumpOpen((v) => !v)}
					aria-expanded={jumpOpen}
				>
					<span>{t.platformRulesLabel}</span>
					<span className="settings-disclosure__meta">
						{t.platformCount(3)}
					</span>
					<svg
						className={`settings-service__chevron${jumpOpen ? " settings-service__chevron--open" : ""}`}
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

			{jumpOpen && (
				<div className="settings-disclosure__body">
					<div className="settings-field">
							<label className="settings-field__label" htmlFor="supjav-name">
								{t.platformNameLabel}
							</label>
							<div className="settings-field__input-wrap">
								<input
									id="supjav-name"
									type="text"
									className="settings-field__input"
									value={d.supjavName}
									onChange={(e) => d.setSupjavName(e.target.value)}
									placeholder={t.platformNameLabel}
									spellCheck={false}
									autoComplete="off"
								/>
								<ClearButton
									show={Boolean(d.supjavName)}
									onClick={() => d.setSupjavName("")}
									title={t.clearInput}
								/>
							</div>
						</div>

						<div className="settings-field">
							<label className="settings-field__label" htmlFor="supjav-template">
								{t.platformUrlLabel(d.supjavName || t.customPlatformName)}
							</label>
							<div className="settings-field__input-wrap">
								<input
									id="supjav-template"
									type="text"
									className="settings-field__input"
									value={d.supjav}
									onChange={(e) => d.setSupjav(e.target.value)}
									placeholder="https://example.com/search?q={code}"
									spellCheck={false}
									autoComplete="off"
								/>
								<ClearButton
									show={Boolean(d.supjav)}
									onClick={() => d.setSupjav("")}
									title={t.clearInput}
								/>
							</div>
						</div>

						<div className="settings-field">
							<label className="settings-field__label" htmlFor="javdb-name">
								{t.platformNameLabel}
							</label>
							<div className="settings-field__input-wrap">
								<input
									id="javdb-name"
									type="text"
									className="settings-field__input"
									value={d.javdbName}
									onChange={(e) => d.setJavdbName(e.target.value)}
									placeholder={t.platformNameLabel}
									spellCheck={false}
									autoComplete="off"
								/>
								<ClearButton
									show={Boolean(d.javdbName)}
									onClick={() => d.setJavdbName("")}
									title={t.clearInput}
								/>
							</div>
						</div>

						<div className="settings-field">
							<label className="settings-field__label" htmlFor="javbus-template">
								{t.platformUrlLabel(d.javdbName || t.customPlatformName)}
							</label>
							<div className="settings-field__input-wrap">
								<input
									id="javbus-template"
									type="text"
									className="settings-field__input"
									value={d.javbus}
									onChange={(e) => d.setJavbus(e.target.value)}
									placeholder="https://example.com/search?q={code}"
									spellCheck={false}
									autoComplete="off"
								/>
								<ClearButton
									show={Boolean(d.javbus)}
									onClick={() => d.setJavbus("")}
									title={t.clearInput}
								/>
							</div>
						</div>

						<div className="settings-field">
							<label className="settings-field__label" htmlFor="custom-name">
								{t.platformNameLabel}
							</label>
							<div className="settings-field__input-wrap">
								<input
									id="custom-name"
									type="text"
									className="settings-field__input"
									value={d.customName}
									onChange={(e) => d.setCustomName(e.target.value)}
									placeholder={t.platformNameLabel}
									spellCheck={false}
									autoComplete="off"
								/>
								<ClearButton
									show={Boolean(d.customName)}
									onClick={() => d.setCustomName("")}
									title={t.clearInput}
								/>
							</div>
						</div>

						<div className="settings-field">
							<label className="settings-field__label" htmlFor="custom-template">
								{t.platformUrlLabel(d.customName || t.customPlatformName)}
							</label>
							<div className="settings-field__input-wrap">
								<input
									id="custom-template"
									type="text"
									className="settings-field__input"
									value={d.customTemplate}
									onChange={(e) => d.setCustomTemplate(e.target.value)}
									placeholder="https://example.com/search?q={code}"
									spellCheck={false}
									autoComplete="off"
								/>
								<ClearButton
									show={Boolean(d.customTemplate)}
									onClick={() => d.setCustomTemplate("")}
									title={t.clearInput}
								/>
							</div>
						</div>
					</div>
				)}
			</SettingsSection>
			<SettingsSection title={t.settingsGroupVersion}>
				<section className="settings-version">
					<span className="settings-version__label">
						{t.extensionVersionLabel}
					</span>
					<div className="settings-version__value-group">
						<code className="settings-version__value">
							v{browser.runtime.getManifest().version}
						</code>
						{updateCheck?.status === "latest" && (
							<span className="settings-version__status">{t.upToDateLabel}</span>
						)}
						{updateCheck?.status === "update" && (
							<span className="settings-version__status settings-version__status--update">
								{t.updateAvailableShort}
							</span>
						)}
					</div>

					{updateCheck && (
						<div className="settings-version__actions">
							{/* 只有确实有更新时才给下载入口；地址缺省（资产非法）则只留检查按钮 */}
							{updateCheck.status === "update" && updateCheck.downloadUrl && (
								<a
									className="settings-version__icon-btn"
									href={updateCheck.downloadUrl}
									target="_blank"
									rel="noopener noreferrer"
									title={t.downloadUpdate}
									aria-label={t.downloadUpdate}
								>
									<svg
										className="icon-download"
										viewBox="0 0 1024 1024"
										fill="currentColor"
										aria-hidden="true"
									>
										<path d="M795.694545 395.636364a289.047273 289.047273 0 0 0-567.38909 0 197.585455 197.585455 0 0 0 18.385454 395.636363h30.952727a23.272727 23.272727 0 0 0 0-46.545454H246.690909a151.272727 151.272727 0 1 1-2.327273-302.545455l23.272728 5.352727 3.025454-25.6a242.269091 242.269091 0 0 1 480.814546 0l4.654545 25.134546 23.272727-4.887273a151.272727 151.272727 0 1 1-2.327272 302.545455h-34.909091a23.272727 23.272727 0 0 0 0 46.545454h35.141818a197.585455 197.585455 0 0 0 18.385454-395.636363z" />
										<path d="M628.363636 689.803636l-91.927272 93.090909v-286.254545a23.272727 23.272727 0 0 0-46.545455 0v285.090909l-91.927273-93.090909A23.272727 23.272727 0 1 0 365.149091 721.454545l131.490909 131.723637a23.272727 23.272727 0 0 0 33.047273 0L661.178182 721.454545A23.272727 23.272727 0 1 0 628.363636 689.803636z" />
									</svg>
								</a>
							)}
							<button
								type="button"
								className="settings-version__icon-btn"
								onClick={updateCheck.onCheck}
								disabled={updateCheck.status === "checking"}
								aria-busy={updateCheck.status === "checking"}
								title={t.checkUpdateAction}
								aria-label={t.checkUpdateAction}
							>
								<svg
									className={`icon-refresh ${updateCheck.status === "checking" ? "icon-refresh--spinning" : ""}`}
									viewBox="0 0 20 20"
									fill="currentColor"
									width="16"
									height="16"
									aria-hidden="true"
								>
									<path
										fillRule="evenodd"
										d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
										clipRule="evenodd"
									/>
								</svg>
							</button>
						</div>
					)}

					{updateCheck?.status === "error" && (
						<p className="settings-version__error" aria-live="polite">
							{t.updateCheckFailed}
						</p>
					)}
				</section>
			</SettingsSection>

		</div>
	);
}
