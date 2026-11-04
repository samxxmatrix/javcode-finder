/**
 * 缓存条目的口径：版本号、键卫生守门、条目可用性判定。纯函数，无 IO。
 * 见 docs/superpowers/specs/2026-10-06-dmm-preview-quality-design.md §7 / §14 / §16。
 */

/**
 * 条目版本。改动响应字段口径 / 档位默认值时必须 +1：
 * 永久缓存不会自己失效，读到版本不符即当未命中并重解析覆盖（不清 Redis、键名不变）。
 * 本次从"无版本字段"直接进入 2。历史条目无 v 字段；起点数字任取，2 只是为了避免"曾经有过 v: 1"的误读。
 * 3 = 新增 actresses / delivery_date / sale_date（2026-10-10，封面浮条）。
 * 4 = 修复 digital 分支 `detail` 重组漏字段（3 的条目可能已以空元数据落库，必须整体作废重抓）。
 */
export const SCHEMA_VERSION = 4;

/** 键语法：首字符必须是 ASCII 字母 / 数字，其后 1..31 位允许字母 / 数字 / `.` / `_` / `-`（总长 2..32）。 */
const CLEAN_KEY = /^[A-Z0-9][A-Z0-9._-]{1,31}$/;

/**
 * 键卫生守门：**纯语法**判断这串字能不能当缓存键，不认识任何番号类别。
 *
 * 允许集：ASCII 字母 / 数字，加 `.` `_` `-`；长度 2..32；首字符不得是分隔符。
 * 入参先规范化 NFKC → trim → toUpperCase 再匹配：首尾空白会被修复，**内部空白不会**。
 *
 * 为什么不做番号抽取：番号知识（有码正则、无码 T1/T2 规则）只在扩展端一处维护；
 * 反代复制一份必然漂移，且每加一个类别都要重新部署反代。
 * 调用方必须：返回 null ⇒ 既不读也不写缓存。
 * 干净入参（ASCII）不被拒绝，返回的键与接入前逐字相同（旧键 = 已 trim 入参的 toUpperCase）；非 ASCII 入参会先经 NFKC 归一（接入前不会），这类键只会是垃圾键，不在零回归承诺范围内。
 *
 * ⚠️ 禁止去前导零 / 补零：`SSIS-001`、`BDSM-091`、`072126-100` 里的数字段是作品号的一部分。
 * @param raw 原始番号入参（任意类型，先 String(raw ?? "") 再规范化）
 * @returns 干净的缓存键（大写）；不合法返回 null
 */
export function cacheKeyFrom(raw) {
	const s = String(raw ?? "").normalize("NFKC").trim().toUpperCase();
	return CLEAN_KEY.test(s) ? s : null;
}

/**
 * 条目是否可用。
 * @param entry 缓存读到的 JSON 对象
 * @param expectedCode 期望的番号，必须是**规范化后的键**（`cacheKeyFrom(...)` 的返回值）；
 *   传原始入参（如小写 `iptd-700`）会让每次读取都静默未命中 —— 不报错、不写日志。
 *   条目里的 code 必须与它逐字相同（§14 脏条目守卫）。
 * @param quality 期望的档位覆盖值。undefined = 完全不校验该字段（/cid 式两参调用）；
 *   null = 条目的 quality 必须是 null **或缺失**（缺失经 `entry.quality ?? null` 刻意当作 null）；
 *   数字 = 精确相等。
 * @returns 可用时返回条目本身；否则 null
 */
export function usableEntry(entry, expectedCode, quality) {
	if (!entry || typeof entry !== "object") return null;
	if (entry.v !== SCHEMA_VERSION) return null;
	if (entry.code !== expectedCode) return null;
	if (quality !== undefined && (entry.quality ?? null) !== quality) return null;
	return entry;
}

/** 资料不全的条目缓存多久（秒）：默认 6 小时。见 spec §7「字段完整性分级 TTL」。 */
export const INCOMPLETE_TTL_SECONDS = 21600;

/**
 * 条目是否"资料不全"：`title` / `cover_url` / `preview_url` 任一缺失（null / undefined / 空白串）。
 *
 * 为什么只看这三个：它们是"面板能不能用"的最小集合 —— 缺任何一个，界面都会不完整；
 * 而源站补齐后**只有重新抓取**才能拿到（缓存不会自己更新）。其余字段（`preview_qualities` 等）
 * 都是派生值，跟着这三个走。
 *
 * ⚠️ 本判定不认识"按设计就只有 cid"的条目：`CID:` 前缀条目天生没有这三个字段，
 * 由调用方（handleCidOnly）自行豁免，否则每次都要重抓、拿不到任何增量。
 */
export function isEntryIncomplete(entry) {
	if (!entry || typeof entry !== "object") return true;
	return [entry.title, entry.cover_url, entry.preview_url].some(
		(value) => typeof value !== "string" || !value.trim(),
	);
}

/**
 * 写缓存时应下发的 TTL（秒）：资料不全 → `ttlSeconds`；资料齐全 → null（永久缓存）。
 * `ttlSeconds <= 0` 表示关闭该策略（一律永久）——运维旋钮，见 `INCOMPLETE_CACHE_TTL_SECONDS`。
 * @param entry 即将写入的条目
 * @param ttlSeconds 资料不全时的 TTL（秒）
 * @returns 秒数或 null
 */
export function entryTtlSeconds(entry, ttlSeconds) {
	if (!(ttlSeconds > 0)) return null;
	return isEntryIncomplete(entry) ? ttlSeconds : null;
}
