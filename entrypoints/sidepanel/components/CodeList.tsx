import React, { useState } from "react";
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

interface CodeListProps {
	candidates: string[];
	t: LocaleMessages;
	locale: SupportedLocale;
	selectedCode: string | null;
	onPreview: (code: string) => void;
}

export const CodeList: React.FC<CodeListProps> = ({
	candidates,
	t,
	locale,
	selectedCode,
	onPreview,
}) => {
	if (candidates.length === 0) return null;

	const settings = getSettings();
	// 按钮显示名称来自配置，空值时回退默认名称
	const supjavName = settings.supjavName || DEFAULT_SETTINGS.supjavName;
	const javdbName = settings.javdbName || DEFAULT_SETTINGS.javdbName;
	const [locateStates, setLocateStates] = useState<
		Record<
			string,
			{
				status: "idle" | "success" | "not_found";
				index?: number;
				total?: number;
			}
		>
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
			[code]: {
				status: res.found ? "success" : "not_found",
				index: res.matchIndex,
				total: res.totalMatches,
			},
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
								}`}
								role={isSelected ? undefined : "button"}
								tabIndex={isSelected ? -1 : 0}
								title={isSelected ? undefined : t.previewTitle}
								onClick={() => {
									// 已选中的番号不再响应点击
									if (!isSelected) onPreview(code);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										if (!isSelected) onPreview(code);
									}
								}}
							>
								{code}
							</span>
							<div className="unmatched-item__links">
								<button
									type="button"
									className={`unmatched-item__link unmatched-item__link--locate ${
										locateState.status === "success"
											? "unmatched-item__link--locate-success"
											: locateState.status === "not_found"
												? "unmatched-item__link--locate-fail"
												: ""
									}`}
									onClick={() => handleLocate(code)}
									title={t.locateTitle}
									aria-label={`${t.locateTitle}: ${code}`}
								>
									{locateState.status === "success" ? (
										<>
											<svg
												className="icon-locate"
												viewBox="0 0 20 20"
												fill="currentColor"
												width="13"
												height="13"
												aria-hidden="true"
											>
												<path
													fillRule="evenodd"
													d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
													clipRule="evenodd"
												/>
											</svg>
											<span>
												{locateState.total && locateState.total > 1
													? `${t.locateSuccess} (${locateState.index}/${locateState.total})`
													: t.locateSuccess}
											</span>
										</>
									) : locateState.status === "not_found" ? (
										<span>{t.locateNotFound}</span>
									) : (
										<>
											<svg
												className="icon-locate"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2.2"
												strokeLinecap="round"
												strokeLinejoin="round"
												width="13"
												height="13"
												aria-hidden="true"
											>
												<circle cx="12" cy="12" r="7" />
												<line x1="12" y1="1" x2="12" y2="5" />
												<line x1="12" y1="19" x2="12" y2="23" />
												<line x1="1" y1="12" x2="5" y2="12" />
												<line x1="19" y1="12" x2="23" y2="12" />
											</svg>
											<span>{t.locate}</span>
										</>
									)}
								</button>
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
							</div>
						</li>
					);
				})}
			</ul>
		</section>
	);
};
