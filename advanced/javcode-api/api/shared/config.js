/**
 * 环境变量集中读取：对外只有一个清晰度偏好入口，内部按来源解释。
 *
 * PREVIEW_QUALITY 是「目标偏好」不是精确档位：DMM 用它推导选档区间，
 * D2PASS 先映射到站点真实存在的档位（其候选列表里没有 320p）。
 */

const DEFAULT_PREVIEW_QUALITY = '320p';
const DEFAULT_D2PASS_ORDER = ['480p', '360p', '240p', '720p', '1080p'];
const DEFAULT_HEYZO_ORDER = ['sample_low', 'sample', 'sample_hd'];

const QUALITY_MAP = Object.freeze({
	'240p': { normal: '240p', heyzo: 'sample_low' },
	'320p': { normal: '360p', heyzo: 'sample_low' },
	'360p': { normal: '360p', heyzo: 'sample_low' },
	'480p': { normal: '480p', heyzo: 'sample' },
	'720p': { normal: '720p', heyzo: 'sample_hd' },
	'1080p': { normal: '1080p', heyzo: 'sample_hd' },
});

function num(key, fallback) {
	const value = Number(process.env[key]);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function list(key, fallback) {
	const raw = process.env[key] || '';
	const parsed = raw.split(',').map((s) => s.trim()).filter(Boolean);
	return parsed.length ? parsed : fallback;
}

function flag(key, fallback) {
	return process.env[key] === undefined ? fallback : process.env[key] !== 'false';
}

/** 把 NNNp 解析成像素高度；非法输入回退 320。 */
export function parseQualityHeight(value) {
	const match = /^(\d{3,4})[pP]$/.exec(String(value || '').trim());
	return match ? Number(match[1]) : 320;
}

/** 把目标偏好放到优先级列表首位，保持其余顺序。 */
function prioritize(order, wanted) {
	if (!wanted || !order.includes(wanted)) return order;
	return [wanted, ...order.filter((q) => q !== wanted)];
}

/** 读取本次请求生效的配置（扁平结构，两边按需取字段）。 */
export function readConfig() {
	const quality = String(process.env.PREVIEW_QUALITY || DEFAULT_PREVIEW_QUALITY).trim().toLowerCase();
	const mapped = QUALITY_MAP[quality] || QUALITY_MAP[DEFAULT_PREVIEW_QUALITY];
	const target = parseQualityHeight(quality);
	return {
		apiKey: (process.env.API_KEY || '').trim(),
		redisUrl: process.env.REDIS_URL || '',
		previewQuality: quality,
		targetHeight: target,
		batchMax: num('BATCH_MAX', 50),
		previewEnabled: flag('PREVIEW_ENABLED', true),
		previewVerify: flag('PREVIEW_VERIFY', true),
		// DMM 分支：以目标高度为中心推导区间，复用原有区间选档逻辑
		minHeight: Math.max(0, target - 120),
		maxHeight: target + 120,
		probeBudgetMs: num('PROBE_BUDGET_MS', 12000),
		incompleteTtlSeconds: num('INCOMPLETE_CACHE_TTL_SECONDS', 21600),
		falenoOrigin: (process.env.FALENO_ORIGIN || 'https://faleno.jp').replace(/\/+$/, ''),
		// D2PASS 分支
		sourceTimeoutMs: num('SOURCE_TIMEOUT_MS', 6000),
		d2passTimeoutMs: num('D2PASS_TIMEOUT_MS', 4000),
		budgetMs: num('TOTAL_BUDGET_MS', 12000),
		negativeTtlHours: process.env.NEGATIVE_TTL_HOURS === undefined ? 6 : Number(process.env.NEGATIVE_TTL_HOURS),
		rateLimitPerMin: num('RATE_LIMIT_PER_MIN', 120),
		useRsc: flag('D2PASS_USE_RSC', true),
		disabledSites: list('DISABLED_SITES', []),
		previewOrder: prioritize(DEFAULT_D2PASS_ORDER, mapped.normal),
		heyzoOrder: prioritize(DEFAULT_HEYZO_ORDER, mapped.heyzo),
	};
}
