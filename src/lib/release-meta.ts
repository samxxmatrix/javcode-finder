/**
 * 封面浮条的元数据纯函数：日期归一化与优先级、出演者清洗与拆分。
 *
 * 职责边界（见 docs/superpowers/specs/2026-10-10-cover-performers-release-date-design.md §4.3）：
 * - **反代只交原始抓取值**（如 `2026/10/2`、`2026-09-30T15:00:00Z`），优先级与归一化在本模块完成，便于单测；
 * - 任何解析不出来的输入一律"视为没有"，绝不猜、不补默认值。
 */

/** 只认「年-月-日」三段式；分隔符吃 `-` `/` `.` 与日文写法「年/月/日」 */
const DATE_PATTERN = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/;

/**
 * ISO 8601 时间戳（含时间分量）：DMM 数字版的 `deliveryStartDate` 形如
 * `2026-09-30T15:00:00Z`。日期与纯日期串分开处理 —— 时间戳必须按 JST 取日期。
 */
const ISO_PATTERN =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * 英式/美式「日 月 年」写法：javtrailers 日语详情页的 `商品発売日` 实测是
 * `01 Oct 2026`（即便页面是 ja，日期仍用英文月缩写）。
 */
const EN_MONTHS: Record<string, number> = {
	jan: 1,
	feb: 2,
	mar: 3,
	apr: 4,
	may: 5,
	jun: 6,
	jul: 7,
	aug: 8,
	sep: 9,
	sept: 9,
	oct: 10,
	nov: 11,
	dec: 12,
};
const DMY_PATTERN = /^(\d{1,2})\s+([A-Za-z]{3,4})\.?\s+(\d{4})$/;

/** 日本无夏令时：全年 UTC+9 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 年份下限：低于 1900 的日期只会是脏值（作品番号日期从 1990 年代起） */
const MIN_YEAR = 1900;
const MAX_YEAR = 2999;

/** 年月日 → `YYYY-MM-DD`；非法日历日期（2 月 30 日等）返回 null */
function buildDate(year: number, month: number, day: number): string | null {
	if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return null;
	if (!Number.isInteger(month) || month < 1 || month > 12) return null;
	if (!Number.isInteger(day) || day < 1 || day > 31) return null;

	// UTC 构造 + 逐字段回读：2 月 30 日会被 Date 归一成 3 月 2 日，回读即露馅
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null;
	}

	const mm = String(month).padStart(2, "0");
	const dd = String(day).padStart(2, "0");
	return `${year}-${mm}-${dd}`;
}

/**
 * 源站日期 → `YYYY-MM-DD`。
 * 接受 `2026-10-02` / `2026/10/2` / `2026.10.2` / `2026年10月2日`（容忍首尾空白），
 * **以及 ISO 8601 时间戳**（`2026-09-30T15:00:00Z` / `2026-10-01T00:00:00+09:00`）—— ISO 一律按
 * JST（UTC+9）取日期：DMM 数字版的 `deliveryStartDate` 实测是 UTC 零点前移 9 小时，slice 前 10 位会差一天。
 * **校验真实日历日期**：`2026-02-30`、月份 13、日 0 一律 null。
 * 非字符串、空串、夹杂其它文字的字符串（如 `2026/10/2 配信開始`）一律 null。
 */
export function normalizeReleaseDate(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;

	// ISO 时间戳：按 JST 取日期，再走与纯日期串相同的输出格式
	if (ISO_PATTERN.test(trimmed)) {
		const at = Date.parse(trimmed);
		if (Number.isNaN(at)) return null;
		return new Date(at + JST_OFFSET_MS).toISOString().slice(0, 10);
	}

	const match = DATE_PATTERN.exec(trimmed);
	if (match) {
		return buildDate(Number(match[1]), Number(match[2]), Number(match[3]));
	}

	// 「日 月 年」英文月写法（javtrailers 日语详情页的 商品発売日 实测为 `01 Oct 2026`）
	const dmy = DMY_PATTERN.exec(trimmed);
	if (dmy) {
		const month = EN_MONTHS[(dmy[2] ?? "").toLowerCase()];
		if (!month) return null;
		return buildDate(Number(dmy[3]), month, Number(dmy[1]));
	}

	return null;
}

/**
 * 发布日优先级：**配信開始日 / 配信日** 优先，没有（或非法）才用 **商品発売日 / 発売日**。
 * 两个都取不到 → null。
 */
export function pickReleaseDate(delivery: unknown, sale: unknown): string | null {
	return normalizeReleaseDate(delivery) ?? normalizeReleaseDate(sale);
}

/**
 * 出演者分隔符：顿号、半/全角逗号、中点、斜杠。
 * ⚠️ **不按空白切**：源站的名字可能自带空格（如 0930 系的「船井 悠佳」），
 * 按空格切会把一个人拆成两个；分隔多人由源侧用上面这些分隔符。
 */
const PERFORMER_SEPARATORS = /[、,，・/]+/;

/**
 * 出演者 → 名字数组。
 * - 数组（DMM / FALENO 反代）：逐项清洗，**不再切分**；
 * - 字符串（D2PASS 单字段、源站一格多人）：先按 PERFORMER_SEPARATORS 切分再清洗；
 * - 其它类型 → `[]`。
 * 每个名字内部的连续空白压成单个空格（`船井  悠佳` → `船井 悠佳`）；
 * 去重**按原样**（区分大小写）并保留首次出现顺序。
 */
export function toPerformers(raw: unknown): string[] {
	const items = Array.isArray(raw)
		? raw
		: typeof raw === "string"
			? raw.split(PERFORMER_SEPARATORS)
			: [];
	const seen = new Set<string>();
	const names: string[] = [];
	for (const item of items) {
		if (typeof item !== "string") continue;
		const name = item.replace(/\s+/g, " ").trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		names.push(name);
	}
	return names;
}
