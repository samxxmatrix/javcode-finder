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

	// 分页条：固定骨架，保证连续翻页时按钮位置不动。
	// - 左右箭头为最外侧固定槽位；当前页在最前/最后时隐藏对应箭头（visibility 占位不移除，避免抖动）。
	// - 非截断（≤ MAX_DOTS 页）：平铺所有页码点，无省略号。
	// - 截断（> MAX_DOTS 页）：固定槽位骨架 = 首页点 + 左省略号槽 + 7 个窗口点 + 右省略号槽 + 末页点；
	//   省略号槽始终占位（需要才显示「…」），因此宽度恒定，窗口点按槽位 key 复用不重挂载。
	const renderPager = () => {
		if (totalPages <= 1) return null;
		// 扫描上限 MAX_CANDIDATES=500、每页 PAGE_SIZE=50 ⇒ 主列表最多 10 页。
		// 阈值设为该上限：扫描结果分页永远不进入截断分支、所有点平铺。
		const MAX_DOTS = 10;
		const WINDOW = 7; // 截断态中间窗口固定 7 个页码点

		const atFirst = safePage === 0;
		const atLast = safePage === totalPages - 1;

		const prevArrow = (
			<button
				type="button"
				className={`favorites-pager__arrow${
					atFirst ? " favorites-pager__arrow--hidden" : ""
				}`}
				onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
				disabled={atFirst}
				aria-label={t.prevPage}
			>
				‹
			</button>
		);
		const nextArrow = (
			<button
				type="button"
				className={`favorites-pager__arrow${
					atLast ? " favorites-pager__arrow--hidden" : ""
				}`}
				onClick={() =>
					setCurrentPage((p) => Math.min(totalPages - 1, p + 1))
				}
				disabled={atLast}
				aria-label={t.nextPage}
			>
				›
			</button>
		);

		// 单个页码点：key 固定为页码，按钮位置在翻页间保持稳定
		const dot = (page: number) => (
			<button
				key={page}
				type="button"
				className={`favorites-pager__dot ${
					page === safePage ? "favorites-pager__dot--active" : ""
				}`}
				onClick={() => setCurrentPage(page)}
				aria-label={t.pageLabel(page + 1)}
				title={t.pageLabel(page + 1)}
			/>
		);

		let body: React.ReactNode;
		if (totalPages <= MAX_DOTS) {
			// 非截断：平铺全部页码点
			body = Array.from({ length: totalPages }, (_, i) => dot(i));
		} else {
			// 截断：固定槽位窗口骨架（窗口点按槽位 key 复用，翻页只换页码与激活态）
			const last = totalPages - 1;
			const start = Math.max(
				1,
				Math.min(safePage - Math.floor(WINDOW / 2), last - WINDOW),
			);
			const showLeftGap = start > 1;
			const showRightGap = start + WINDOW - 1 < last - 1;
			const gap = (key: string, filled: boolean) => (
				<span key={key} className="favorites-pager__gap" aria-hidden="true">
					{filled ? "…" : ""}
				</span>
			);
			body = (
				<>
					{dot(0)}
					{gap("gL", showLeftGap)}
					{Array.from({ length: WINDOW }, (_, k) => {
						const page = start + k;
						return (
							<button
								key={`w${k}`}
								type="button"
								className={`favorites-pager__dot ${
									page === safePage ? "favorites-pager__dot--active" : ""
								}`}
								onClick={() => setCurrentPage(page)}
								aria-label={t.pageLabel(page + 1)}
								title={t.pageLabel(page + 1)}
							/>
						);
					})}
					{gap("gR", showRightGap)}
					{dot(last)}
				</>
			);
		}

		return (
			<div className="favorites-pager">
				{prevArrow}
				{body}
				{nextArrow}
			</div>
		);
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
