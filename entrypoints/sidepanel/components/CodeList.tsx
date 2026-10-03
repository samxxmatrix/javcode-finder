import React, { useState } from "react";
import { isFavorite } from "../../../src/lib/favorites";
import { locateCodeInActiveTab } from "../../../src/lib/locate-code";
import type { LocaleMessages } from "../../../src/lib/locales";
import { normalizeCode } from "../../../src/lib/normalize-code";
import {
	DEFAULT_SETTINGS,
	getSettings,
	resolveSearchUrl,
	resolveSupjavUrl,
} from "../../../src/lib/settings";
import type { SupportedLocale } from "../../../src/lib/types";
import { EmbyBadge } from "./EmbyBadge";
import { FavoriteIcon } from "./FavoriteIcon";

interface CodeListProps {
	candidates: string[];
	t: LocaleMessages;
	locale: SupportedLocale;
	selectedCode: string | null;
	onPreview: (code: string) => void;
	favorites: string[];
	onToggleFavorite: (code: string) => void;
	inLibrary?: Set<string>;
}

export const CodeList: React.FC<CodeListProps> = ({
	candidates,
	t,
	locale,
	selectedCode,
	onPreview,
	favorites,
	onToggleFavorite,
	inLibrary = new Set<string>(),
}) => {
	if (candidates.length === 0) return null;

	const settings = getSettings();
	// 按钮显示名称来自配置，空值时回退默认名称
	const supjavName = settings.supjavName || DEFAULT_SETTINGS.supjavName;
	const javdbName = settings.javdbName || DEFAULT_SETTINGS.javdbName;
	// 自定义平台无默认配置：名称与模板均非空才显示按钮
	const customName = settings.customName.trim();
	const customTemplate = settings.customTemplate.trim();
	const showCustom = Boolean(customName && customTemplate);
	const [locateStates, setLocateStates] = useState<
		Record<string, { status: "idle" | "success" | "not_found" }>
	>({});

	// Deduplicate candidates
	const seen = new Set<string>();
	const uniqueCodes: string[] = [];
	for (const candidate of candidates) {
		const normalized = normalizeCode(candidate);
		if (normalized && !seen.has(normalized)) {
			seen.add(normalized);
			uniqueCodes.push(normalized);
		}
	}

	// 直接按模板打开 supJAV 搜索页（无需解析）
	const handleSupjavClick = async (code: string) => {
		const url = resolveSupjavUrl(settings.supjavTemplate, code, locale);
		try {
			await browser.tabs.create({ url });
		} catch {
			window.open(url, "_blank", "noopener,noreferrer");
		}
	};

	const handleLocate = async (code: string) => {
		const res = await locateCodeInActiveTab(code);
		setLocateStates((prev) => ({
			...prev,
			[code]: { status: res.found ? "success" : "not_found" },
		}));
		setTimeout(() => {
			setLocateStates((prev) => ({
				...prev,
				[code]: { status: "idle" },
			}));
		}, 3000);
	};

	return (
		<section className="unmatched-section">
			<div className="unmatched-section__header">
				<h3 className="unmatched-section__title">
					{t.codesListTitle}{" "}
					<span className="unmatched-section__count">
						{uniqueCodes.length}
					</span>
				</h3>
			</div>

			<ul className="unmatched-section__list">
				{uniqueCodes.map((code) => {
					const javdbUrl = resolveSearchUrl(settings.javbusTemplate, code);
					const locateState = locateStates[code] || { status: "idle" };

					const isSelected = code === selectedCode;
					return (
						<li key={code} className="unmatched-item">
							<span
								className={`unmatched-item__code ${
									isSelected ? "unmatched-item__code--selected" : ""
								} ${
									locateState.status === "success"
										? "unmatched-item__code--locate-success"
										: locateState.status === "not_found"
											? "unmatched-item__code--locate-fail"
											: ""
								}`}
								role={isSelected ? undefined : "button"}
								tabIndex={isSelected ? -1 : 0}
								title={isSelected ? undefined : t.previewTitle}
								onClick={() => {
									// 点击番号：定位目标页面（重复点击循环下一匹配）+ 未选中时打开预览
									void handleLocate(code);
									if (!isSelected) onPreview(code);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										void handleLocate(code);
										if (!isSelected) onPreview(code);
									}
								}}
							>
								{code}
							</span>
							{/* 已收藏的番号紧挨右侧显示图标，点击取消收藏后消失 */}
							{isFavorite(favorites, code) && (
								<button
									type="button"
									className="unmatched-item__fav"
									onClick={() => onToggleFavorite(code)}
									title={t.removeFavorite}
									aria-label={`${t.removeFavorite}: ${code}`}
								>
									<FavoriteIcon active />
								</button>
							)}
							{/* 已在 Emby 库：纯标识，位于收藏图标右侧，位置不随收藏状态变化 */}
							{inLibrary.has(code) && (
								<span
									className="unmatched-item__in-library"
									role="img"
									title={t.embyInLibrary}
									aria-label={t.embyInLibrary}
								>
									<EmbyBadge />
								</span>
							)}
							<div className="unmatched-item__links">
								<button
									type="button"
									className="unmatched-item__link unmatched-item__link--supjav"
									title={`Search ${code} on ${supjavName}`}
									onClick={() => handleSupjavClick(code)}
								>
									{supjavName}
								</button>
								<a
									href={javdbUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="unmatched-item__link unmatched-item__link--javdb"
									title={`Search ${code} on ${javdbName}`}
								>
									{javdbName}
								</a>
								{showCustom && (
									<a
										href={resolveSearchUrl(customTemplate, code)}
										target="_blank"
										rel="noopener noreferrer"
										className="unmatched-item__link unmatched-item__link--custom"
										title={`Search ${code} on ${customName}`}
									>
										{customName}
									</a>
								)}
							</div>
						</li>
					);
				})}
			</ul>
		</section>
	);
};
