import React, { useEffect, useState } from "react";
import { isFavorite } from "../../../src/lib/favorites";
import { locateCodeInActiveTab } from "../../../src/lib/locate-code";
import type { LocaleMessages } from "../../../src/lib/locales";
import {
	dedupeDisplayCodes,
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

/** 收藏夹分页每页条数：索引式分页，每页恒定条数 */
const PAGE_SIZE = 50;

interface CodeListProps {
	candidates: string[];
	t: LocaleMessages;
	locale: SupportedLocale;
	selectedCode: string | null;
	onPreview: (code: string) => void;
	favorites: string[];
	onToggleFavorite: (code: string) => void;
	inLibrary: Set<string>;
	/** 收藏夹模式：标题改为「收藏夹的番号」；点击番号只预览、不做页面定位；空态显示占位 */
	favoritesMode?: boolean;
	/** 切换收藏夹模式（标题右侧「收藏夹」按钮） */
	onToggleFavoritesMode?: () => void;
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
	favoritesMode = false,
	onToggleFavoritesMode,
}) => {
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
	// 索引式分页：页号状态（Hook 必须无条件调用，故置于早返回之前）
	const [currentPage, setCurrentPage] = useState(0);

	// 去重：保序、按归一化形式。`-` 与 `_` 是两个号（不同片商），都必须留在列表里
	const uniqueCodes = dedupeDisplayCodes(candidates);
	const totalPages = Math.max(1, Math.ceil(uniqueCodes.length / PAGE_SIZE));
	// 编辑导致总页数减少时当前页可能越界，用 safePage 统一夹取后再切片/高亮
	const safePage = Math.min(currentPage, totalPages - 1);
	const pageCodes = uniqueCodes.slice(
		safePage * PAGE_SIZE,
		(safePage + 1) * PAGE_SIZE,
	);

	// 仅切换收藏夹模式时回到首页（看最新收藏）；同模式内增删收藏不重置页号
	useEffect(() => {
		setCurrentPage(0);
	}, [favoritesMode]);
	// 编辑使总页数减少、当前页越界时，回退到最后一页（clamp）
	useEffect(() => {
		if (currentPage > totalPages - 1) setCurrentPage(totalPages - 1);
	}, [totalPages, currentPage]);

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

	// 标题 + 「收藏夹」切换按钮：普通与收藏夹两种模式共用，仅文案与高亮态不同
	const header = (
		<div className="unmatched-section__header">
			<h3 className="unmatched-section__title">
				{favoritesMode ? t.favoritesListTitle : t.codesListTitle}{" "}
				<span className="unmatched-section__count">{uniqueCodes.length}</span>
			</h3>
			{onToggleFavoritesMode && (
				<button
					type="button"
					className={`unmatched-section__fav-toggle ${
						favoritesMode ? "unmatched-section__fav-toggle--active" : ""
					}`}
					onClick={onToggleFavoritesMode}
					title={t.favoritesToggle}
					aria-pressed={favoritesMode}
				>
					<FavoriteIcon active={favoritesMode} variant="outline" />
					<span>{t.favoritesToggle}</span>
				</button>
			)}
		</div>
	);

	// 空态：普通模式由外部 status 控制不渲染本组件；收藏夹模式显示占位（保留切换按钮以便退出）
	if (uniqueCodes.length === 0) {
		if (!favoritesMode) return null;
		return (
			<section className="unmatched-section">
				{header}
				<div className="favorites-empty">{t.favoritesEmpty}</div>
			</section>
		);
	}

	// 分页小点：当前页金色实心，其余灰色；过多时两侧加 ‹ › 箭头平移窗口
	const renderPager = () => {
		if (totalPages <= 1) return null;
		const MAX_DOTS = 7;
		const items: (number | "…")[] = [];
		if (totalPages <= MAX_DOTS) {
			for (let i = 0; i < totalPages; i++) items.push(i);
		} else {
			const side = Math.floor((MAX_DOTS - 2) / 2);
			let left = Math.max(1, safePage - side);
			let right = Math.min(totalPages - 2, safePage + side);
			if (left > 1) items.push(0, "…");
			else items.push(0);
			for (let i = left; i <= right; i++) items.push(i);
			if (right < totalPages - 2) items.push("…");
			items.push(totalPages - 1);
		}
		const dots = items.map((it, idx) => {
			if (it === "…") {
				return (
					<span key={`gap-${idx}`} className="favorites-pager__gap">
						…
					</span>
				);
			}
			const page = it;
			const active = page === safePage;
			return (
				<button
					key={page}
					type="button"
					className={`favorites-pager__dot ${
						active ? "favorites-pager__dot--active" : ""
					}`}
					onClick={() => setCurrentPage(page)}
					aria-label={t.pageLabel(page + 1)}
					title={t.pageLabel(page + 1)}
				/>
			);
		});
		if (totalPages > MAX_DOTS) {
			return (
				<div className="favorites-pager">
					<button
						type="button"
						className="favorites-pager__arrow"
						onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
						disabled={safePage === 0}
						aria-label={t.prevPage}
					>
						‹
					</button>
					{dots}
					<button
						type="button"
						className="favorites-pager__arrow"
						onClick={() =>
							setCurrentPage((p) => Math.min(totalPages - 1, p + 1))
						}
						disabled={safePage === totalPages - 1}
						aria-label={t.nextPage}
					>
						›
					</button>
				</div>
			);
		}
		return <div className="favorites-pager">{dots}</div>;
	};

	return (
		<section className="unmatched-section">
			{header}

			<ul className="unmatched-section__list">
				{pageCodes.map((code) => {
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
									// 收藏夹模式非扫描上下文，定位无意义：只打开预览
									if (!favoritesMode) void handleLocate(code);
									if (!isSelected) onPreview(code);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										if (!favoritesMode) void handleLocate(code);
										if (!isSelected) onPreview(code);
									}
								}}
							>
								{code}
							</span>
							{/* 已收藏的番号紧跟番号显示书签，点击取消收藏后消失 */}
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
							{/* 已在 Emby 库：纯标识，始终排在收藏图标之后（紧跟番号，不右对齐） */}
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

		{renderPager()}
	</section>
	);
};
