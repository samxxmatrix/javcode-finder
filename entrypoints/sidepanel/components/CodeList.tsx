import React, { useState } from "react";
import { isFavorite } from "../../../src/lib/favorites";
import { locateCodeInActiveTab } from "../../../src/lib/locate-code";
import type { LocaleMessages } from "../../../src/lib/locales";
import {
	normalizeCode,
	toExternalSearchCode,
} from "../../../src/lib/normalize-code";
import {
	configuredPlatforms,
	getSettings,
	resolveSearchUrl,
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
	inLibrary: Set<string>;
}

export const CodeList: React.FC<CodeListProps> = ({
	candidates,
	t,
	locale,
	selectedCode,
	onPreview,
	favorites,
	onToggleFavorite,
	inLibrary,
}) => {
	if (candidates.length === 0) return null;

	const settings = getSettings();
	// 平台清单走共享 helper（与预告片头部同一份显示规则）：名称与链接规则都配置了才出现
	const platforms = configuredPlatforms(settings);
	const supjav = platforms.find((platform) => platform.key === "supjav");
	const javdb = platforms.find((platform) => platform.key === "javdb");
	const custom = platforms.find((platform) => platform.key === "custom");
	const showPlatformLinks = platforms.length > 0;
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

	// 直接按模板打开第一平台搜索页（无需解析）
	const handleSupjavClick = async (code: string) => {
		if (!supjav) return;
		const url = resolveSearchUrl(supjav.template, toExternalSearchCode(code));
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
					// 跳转码与显示码分离：FC2 番号外部平台只认 FC2-PPV-<数字> 写法
					const javdbUrl = javdb
						? resolveSearchUrl(javdb.template, toExternalSearchCode(code))
						: "";
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
							{/* 已在 Emby 库：纯标识，始终排在收藏图标之后；收藏图标按状态条件渲染，故横向位置随收藏状态变化，仅先后顺序稳定 */}
							{inLibrary.has(code) && (
								<span
									className="unmatched-item__in-library"
									role="img"
									title={t.embyInLibrary}
									aria-label={`${t.embyInLibrary}: ${code}`}
								>
									<EmbyBadge />
								</span>
							)}
							{showPlatformLinks && (
								<div className="unmatched-item__links">
									{supjav && (
										<button
											type="button"
											className="unmatched-item__link unmatched-item__link--supjav"
											title={`Search ${code} on ${supjav.name}`}
											onClick={() => handleSupjavClick(code)}
										>
											{supjav.name}
										</button>
									)}
									{javdb && (
										<a
											href={javdbUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="unmatched-item__link unmatched-item__link--javdb"
											title={`Search ${code} on ${javdb.name}`}
										>
											{javdb.name}
										</a>
									)}
									{custom && (
										<a
											href={resolveSearchUrl(
												custom.template,
												toExternalSearchCode(code),
											)}
											target="_blank"
											rel="noopener noreferrer"
											className="unmatched-item__link unmatched-item__link--custom"
											title={`Search ${code} on ${custom.name}`}
										>
											{custom.name}
										</a>
									)}
								</div>
							)}
						</li>
					);
				})}
			</ul>
		</section>
	);
};
