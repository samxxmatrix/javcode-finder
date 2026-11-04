/**
 * DMM 预览档位选择：纯函数，无网络 / 无 redis / 无环境变量。
 * 事实与决策见 docs/superpowers/specs/2026-10-06-dmm-preview-quality-design.md §2 / §5。
 */

export const DEFAULT_MIN_HEIGHT = 320;
export const DEFAULT_MAX_HEIGHT = 600;

/** 数字版家族（文件名以 `_w` / `_s` 结尾）：剥掉后缀后查这张表（实测像素） */
const DIGITAL_HEIGHTS = { sm: 180, dm: 316, dmb: 404, mhb: 404 };

/** 主家族（实测像素；同高度的 `*s` 是更高码率的兄弟档） */
const MAIN_HEIGHTS = {
	sm: 144,
	dm: 288,
	mmb: 432,
	mhb: 576,
	hmb: 720,
	hmbs: 720,
	hhb: 1080,
	hhbs: 1080,
	"4k": 2160,
	"4ks": 2160,
};

/** 拆 URI：目录 / 主体（去扩展名）/ 扩展名 / query+fragment */
function splitUri(uri) {
	const text = String(uri || "");
	const path = text.split(/[?#]/)[0];
	const tail = text.slice(path.length);
	const name = path.split("/").pop() || "";
	const dir = path.slice(0, path.length - name.length);
	const ext = (/\.(?:mp4|m3u8)$/i.exec(name) || [])[0] || "";
	return { dir, stem: ext ? name.slice(0, name.length - ext.length) : name, ext, tail };
}

/** 取文件名主体：去 query/fragment、去路径、去 .mp4/.m3u8 */
function stemOf(uri) {
	return splitUri(uri).stem;
}

function familyOf(stem) {
	const digital = /_[ws]$/i.test(stem);
	return {
		base: digital ? stem.replace(/_[ws]$/i, "") : stem,
		table: digital ? DIGITAL_HEIGHTS : MAIN_HEIGHTS,
		suffix: digital ? stem.slice(-2) : "",
	};
}

function longestTokenSuffix(base, table) {
	let best = null;
	const lower = base.toLowerCase();
	for (const token of Object.keys(table)) {
		if (lower.endsWith(token) && (best === null || token.length > best.length)) best = token;
	}
	return best;
}

/**
 * 档位高度：playlist 的 RESOLUTION 优先；缺失时查静态家族表；仍未知返回 null。
 */
export function resolveHeight(uri, resolution) {
	const matched = /^(\d+)x(\d+)$/i.exec(String(resolution ?? "").trim());
	if (matched) return Number(matched[2]);

	const stem = stemOf(uri);
	if (!stem) return null;
	const { base, table } = familyOf(stem);
	const token = longestTokenSuffix(base, table);
	return token === null ? null : table[token];
}

/** playlist 文本 → 档位列表（忽略非 STREAM-INF 行、空 URI、紧随的注释行） */
export function parseHlsVariants(text) {
	const lines = String(text || "").split(/\r?\n/);
	const variants = [];
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
		const uri = (lines[i + 1] || "").trim();
		if (!uri || uri.startsWith("#")) continue;
		const resolution = (line.match(/RESOLUTION=([0-9]+x[0-9]+)/i) || [])[1] || null;
		const bandwidthText =
			(line.match(/AVERAGE-BANDWIDTH=(\d+)/i) || line.match(/BANDWIDTH=(\d+)/i) || [])[1];
		variants.push({
			uri,
			resolution,
			bandwidth: bandwidthText ? Number(bandwidthText) : null,
			height: resolveHeight(uri, resolution),
		});
	}
	return variants;
}

/** 更轻优先：带宽小者在前（缺带宽视为最重）；带宽相同取 height 低者（分辨率更低） */
function isLighter(a, b) {
	const ab = Number.isFinite(a.bandwidth) ? a.bandwidth : Number.MAX_SAFE_INTEGER;
	const bb = Number.isFinite(b.bandwidth) ? b.bandwidth : Number.MAX_SAFE_INTEGER;
	if (ab !== bb) return ab < bb;
	return (a.height ?? 0) < (b.height ?? 0);
}

/** Array#sort 比较器：更轻 -1、更重 1、等价 0（must return 0 for equal keys） */
function byLighter(a, b) {
	if (isLighter(a, b)) return -1;
	if (isLighter(b, a)) return 1;
	return 0;
}

/**
 * 排序 + 命中理由：这些字段是排序依据本身，由单测断言（`?debug=1` 不在本次范围内）。
 *
 * `options.quality` 是**像素高度 number**（如 460），不是 `"432p"` 字符串；由调用方解析，非数字则忽略（退化为区间中点）。
 * 目标：`quality` 给定则用它当唯一目标（区间不参与）；否则 target = 区间中点。
 * 排序规则：**到 target 的距离升序，距离相同取更轻**。
 * 这条规则同时满足 spec §3 的三条（区间内取最近中点 / 全低于下界取最高 / 全高于上界取最低）：
 * 因为 target 落在区间内，任何区间外档位到 target 的距离必然大于最近的区间内档位，
 * 而"全在区间外"时距离最近的就是最靠近区间的那一档。⇒ 不需要单独的区间分支。
 * 高度全未知时退化为"按带宽升序取中位数位置"（偶数取更轻一侧）。
 */
export function rankVariants(variants, options = {}) {
	const minHeight = Number.isFinite(options.minHeight) ? options.minHeight : DEFAULT_MIN_HEIGHT;
	const maxHeight = Number.isFinite(options.maxHeight) ? options.maxHeight : DEFAULT_MAX_HEIGHT;
	const quality = Number.isFinite(options.quality) ? options.quality : null;
	const list = Array.isArray(variants) ? variants : [];
	const target = quality !== null ? quality : (minHeight + maxHeight) / 2;

	if (list.length === 0) {
		return { ordered: [], picked: null, target, inBand: false };
	}

	const known = list.filter((v) => Number.isFinite(v.height));
	if (known.length === 0) {
		const ordered = [...list].sort(byLighter);
		return {
			ordered,
			picked: ordered[Math.floor((ordered.length - 1) / 2)] ?? null,
			target,
			inBand: false,
		};
	}

	const ordered = [...known]
		.sort((a, b) => {
			const da = Math.abs(a.height - target);
			const db = Math.abs(b.height - target);
			if (da !== db) return da - db;
			return byLighter(a, b);
		})
		.concat(list.filter((v) => !Number.isFinite(v.height)).sort(byLighter));

	const picked = ordered[0] ?? null;
	return {
		ordered,
		picked,
		target,
		inBand: known.some((v) => v.height >= minHeight && v.height <= maxHeight),
	};
}

/** 选档（只要结果）；options 契约见 rankVariants */
export function pickVariant(variants, options) {
	return rankVariants(variants, options).picked;
}

/** 按偏好排序（模板探测路径要按顺序逐档校验）；options 契约见 rankVariants */
export function orderByPreference(variants, options) {
	return rankVariants(variants, options).ordered;
}

/** 档位标签：432 → "432p"；未知 → null */
export function qualityLabel(height) {
	return Number.isFinite(height) ? `${height}p` : null;
}

/** 把原档位 token 换成目标 token（保留目录、扩展名、query/fragment 与 `_w`/`_s` 后缀）；形态未知返回 null */
export function replaceQualityToken(uri, token) {
	const { dir, stem, ext, tail } = splitUri(uri);
	if (!stem) return null;
	const { base, table, suffix } = familyOf(stem);
	const matched = longestTokenSuffix(base, table);
	if (matched === null) return null;
	return `${dir}${base.slice(0, base.length - matched.length)}${token}${suffix}${ext}${tail}`;
}

/**
 * 档位 URI → mp4 地址。只改写 path 上的 `.m3u8`，`?query` / `#fragment` 原样保留：
 * - 绝对 URL（`https?://…`）：改写自身 origin 下的 path；
 * - 绝对路径（`/…`）：按 mp4Dir 解析成同源绝对地址，再挂回后缀；
 * - 其他（裸文件名，真实固件全是这一种）：直接拼在 mp4Dir 之后。
 * 解析顺序很重要：`x.m3u8?t=1` 这类带 query 的 URI 如果整串做 `/\.m3u8$/`，
 * 锚点会被 query 击败、改写不动扩展名，把 playlist 当成直链 mp4 返回。
 * 空串 / 非字符串原样返回（不改写、不拼目录）。
 */
export function toMp4Url(mp4Dir, uri) {
	if (typeof uri !== "string" || uri === "") return uri;
	const parts = /^([^?#]*)([\s\S]*)$/.exec(uri);
	const path = parts[1].replace(/\.m3u8$/i, ".mp4");
	const tail = parts[2];
	if (/^https?:\/\//i.test(path)) return `${path}${tail}`;
	if (path.startsWith("/")) return `${new URL(path, mp4Dir).toString()}${tail}`;
	return `${mp4Dir}${path}${tail}`;
}

/** 档位表按分辨率升序（同分辨率按带宽升序），见设计 §9；不改写调用方数组 */
export function shapeQualities(variants, mp4Dir) {
	return [...variants]
		.sort((a, b) => {
			const ah = Number.isFinite(a.height) ? a.height : Number.MAX_SAFE_INTEGER;
			const bh = Number.isFinite(b.height) ? b.height : Number.MAX_SAFE_INTEGER;
			if (ah !== bh) return ah - bh;
			const ab = Number.isFinite(a.bandwidth) ? a.bandwidth : Number.MAX_SAFE_INTEGER;
			const bb = Number.isFinite(b.bandwidth) ? b.bandwidth : Number.MAX_SAFE_INTEGER;
			return ab - bb;
		})
		.map((variant) => ({
			quality: qualityLabel(variant.height),
			height: variant.height ?? null,
			resolution: variant.resolution ?? null,
			bandwidth: variant.bandwidth ?? null,
			url: toMp4Url(mp4Dir, variant.uri),
		}));
}

/** 用静态家族表枚举该文件名的全部候选档位（按高度去重，同高度只取表中首个 token） */
export function familyVariants(uri) {
	const stem = stemOf(uri);
	if (!stem) return [];
	const { table } = familyOf(stem);
	const seen = new Set();
	const out = [];
	for (const [token, height] of Object.entries(table)) {
		if (seen.has(height)) continue;
		seen.add(height);
		const replaced = replaceQualityToken(uri, token);
		if (replaced) {
			out.push({ uri: replaced, resolution: null, bandwidth: null, height });
		}
	}
	return out;
}
