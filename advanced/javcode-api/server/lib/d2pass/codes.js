/**
 * 番号归一化、站点路由、有码/无码识别。
 *
 * 关键约束：**不能把 `_` 归一成 `-`**。分隔符本身是片商标识 ——
 * `100126-100` 是カリビアンコム，`100126_100` 是パコパコママ（实测见 docs/d2pass-api接口文档.md 4.2）。
 */

/** 归一化：全角转半角、大写、压缩空白；**保留 `-` 与 `_` 的原始区别** */
export function normalizeCode(raw) {
	if (!raw) return "";
	return String(raw)
		.normalize("NFKC")
		.trim()
		.replace(/[\s\u3000]+/g, "-")
		.toUpperCase();
}

/** 比较用骨架：去掉所有非字母数字 */
export function codeSkeleton(s) {
	return String(s || "")
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "");
}

/** 日期型片商的日期段必须是合法 MMDDYY */
export function isValidMMDDYY(six) {
	if (!/^\d{6}$/.test(six)) return false;
	const mm = Number(six.slice(0, 2));
	const dd = Number(six.slice(2, 4));
	return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

/**
 * 番号 → 候选站点（按优先级排序）。
 * 返回超过 1 个时，调用方应并发探测后取第一个存在的。
 */
export function routeCandidates(code) {
	const c = normalizeCode(code);
	if (!c) return [];

	// HEYZO
	if (/^HEYZO-?\d{3,5}$/.test(c)) return ["heyzo"];

	// 日期型：6 位日期 + 分隔符 + 2~4 位序号
	let m = /^(\d{6})([-_])(\d{2,4})$/.exec(c);
	if (m && isValidMMDDYY(m[1])) {
		const [, , sep, tail] = m;
		if (sep === "-") return ["caribbeancom"];
		if (tail.length === 2) return ["10musume"];
		if (tail.length === 4) return ["muramura"];
		// 3 位且为下划线：一本道 / パコパコママ / カリビアンコムプレミアム / ムラムラ旧作 四家共用
		return ["1pondo", "pacopacomama", "caribbeancompr", "muramura"];
	}

	// 两段式（Hey動画 / av9898）：4229-2960、4422-032
	if (/^\d{3,5}[-/]\d{2,4}$/.test(c)) return ["heydouga", "av9898"];

	// 3d-eros：3dw-315（数字开头，旧抽取正则漏过）
	if (/^3DW-?\d{3,4}$/.test(c)) return ["3d-eros"];

	// 人妻斬り：hitozuma1579
	if (/^HITOZUMA\d{3,5}$/.test(c)) return ["c0930"];

	// 0930 系
	if (/^GOL\d{3,5}$/.test(c)) return ["h0930"];
	if (/^ORI\d{4,5}$/.test(c)) return ["h0930", "h4610", "unkotare"];

	// 女体のしんぴ：n3351 / les402
	if (/^(?:N\d{4,5}|LES\d{3,4})$/.test(c)) return ["nyoshin"];

	// 裸数字：金髪天國 / ピッカー / HEYZO（三家形态相同，探测决定）
	if (/^\d{4,5}$/.test(c)) return ["kin8tengoku", "pikkur", "heyzo"];

	// 数字开头带分隔且不是日期（如 103_933）：エロックスジャパンZ
	if (/^\d{2,4}[-_]\d{3,4}$/.test(c)) return ["eroxjapanz"];

	return [];
}

/**
 * 分隔符兄弟形态：`100126-100` ↔ `100126_100`。
 *
 * 分隔符是片商标识（连字符=カリビアンコム、下划线=パコパコママ…），但用户很容易记错写法。
 * 主路由失败后用它兜底，避免"番号存在却因为少打一个下划线而 404"。
 */
export function alternateCodes(code) {
	const c = normalizeCode(code);
	const m = /^(\d{6})([-_])(\d{2,4})$/.exec(c);
	if (!m) return [];
	const other = m[2] === "-" ? "_" : "-";
	return [`${m[1]}${other}${m[3]}`];
}

/**
 * 有码 / 无码 / 素人识别。
 * 判错代价很小（两个源查无都在 0.5–3s 返回），因此这里只做"够用"的规则；
 * 真正的判定以解析命中的源为准（源确认优先于形态猜测）。
 */
export function classifyCode(code) {
	const c = normalizeCode(code);
	if (!c) return "unknown";
	if (/^FC2(?:-?PPV)?-?\d{3,8}$/.test(c)) return "amateur";
	if (/^SIRO-?\d{3,6}$/.test(c)) return "amateur";
	if (/^\d{3}[A-Z]{2,6}-\d{3,4}$/.test(c)) return "amateur"; // 259LUXU-1234 / 200GANA-2345
	if (routeCandidates(c).length > 0) return "uncensored";
	if (/^[A-Z][A-Z0-9]{1,5}-\d{2,6}$/.test(c)) return "censored";
	return "unknown";
}

/**
 * 回链校验：D2Pass 商品页链接回源站，用它确认"搜到的商品就是这个番号"。
 * 规则：番号的数字尾段必须出现在回链里（HEYZO-3953 的回链只含 3953，不含前缀）。
 */
export function backlinkMatches(backlinkUrl, code) {
	if (!backlinkUrl) return false;
	const tail = normalizeCode(code).replace(/^[A-Z]+[-_]?/, "");
	const tailSkel = codeSkeleton(tail);
	const urlSkel = codeSkeleton(backlinkUrl);
	if (!tailSkel) return false;
	return urlSkel.includes(tailSkel) || urlSkel.includes(codeSkeleton(code));
}

/** 生成用于 D2Pass 关键词搜索的片段（分词匹配，完整标题常 0 结果） */
export function titleFragments(title) {
	const t = String(title || "").trim();
	if (!t) return [];
	const out = [t];
	const head = t.split(/[~～|｜]/)[0].trim();
	if (head && head !== t) out.push(head);
	const short = t.split(/[\s\u3000]/)[0].slice(0, 14);
	if (short && !out.includes(short)) out.push(short);
	const ultra = t.slice(0, 14);
	if (ultra && !out.includes(ultra)) out.push(ultra);
	return out.filter((x) => x.length >= 2);
}
