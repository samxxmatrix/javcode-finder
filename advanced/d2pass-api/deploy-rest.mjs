/**
 * 用 Vercel REST API 部署（CLI 在本沙箱不可用：它内部 spawn 子进程用管道通信，被命名管道限制挡掉）。
 *
 *   $env:D2PASS_API_KEY="..."; node deploy-rest.mjs
 *
 * 流程：建项目 → 写环境变量 → 内联上传文件创建生产部署 → 轮询到 READY → 打印 URL。
 * token 取值优先级：环境变量 VERCEL_TOKEN → ../SECRETS.local.md 的 `VERCEL_TOKEN_D2PASS` → 旧 token 文件。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.vercel.com";
const PROJECT = process.env.VERCEL_PROJECT || "d2pass-api";
const TEAM_ID = process.env.VERCEL_TEAM_ID || ""; // 空 = 个人 scope
const REGION = process.env.VERCEL_REGION || "hnd1";
// 部署根 = vercel-d2pass 子目录（只放运行时文件）；用脚本自身位置定位，不依赖 cwd
const ROOT = fileURLToPath(new URL("./vercel-d2pass", import.meta.url));

function resolveToken() {
	// 1) 显式环境变量（CI 里最方便）
	if (process.env.VERCEL_TOKEN?.trim()) return process.env.VERCEL_TOKEN.trim();

	// 2) 统一凭据文件：与各部署文档指向同一处，避免 token 散落多份
	const secrets = fileURLToPath(new URL("../SECRETS.local.md", import.meta.url));
	if (fs.existsSync(secrets)) {
		const want = PROJECT.startsWith("d2pass") ? "VERCEL_TOKEN_D2PASS" : "VERCEL_TOKEN_DMM";
		for (const line of fs.readFileSync(secrets, "utf8").split(/\r?\n/)) {
			const cell = line.match(/^\|\s*`([A-Z0-9_]+)`\s*\|\s*`([^`]+)`\s*\|/);
			if (cell && cell[1] === want) return cell[2].trim();
		}
	}

	// 3) 兼容旧的两行 token 文件（标签@token），路径已跟进代码目录迁移
	const file = process.env.VERCEL_TOKEN_FILE || "D:\\WorkBuddy\\VSCode\\vercel-token.txt";
	const lines = fs
		.readFileSync(file, "utf8")
		.split(/\r?\n/)
		.map((s) => s.trim())
		.filter(Boolean);
	// token 文件每行形如 `vercel-dmm@vcp_…` / `d2pass-api@vcp_…`：先按项目名选行，再去掉 `项目名@` 前缀
	// （原实现直接取第 2 行整串，会把 `d2pass-api@` 当成 token 的一部分 → 401）
	const pick = lines.find((line) => line.startsWith(`${PROJECT}@`)) || lines[1] || lines[0];
	if (!pick) throw new Error(`token 文件为空: ${file}`);
	return pick.includes("@") ? pick.slice(pick.lastIndexOf("@") + 1) : pick;
}

const token = resolveToken();
const qs = (extra = {}) => {
	const params = new URLSearchParams(extra);
	if (TEAM_ID) params.set("teamId", TEAM_ID);
	const s = params.toString();
	return s ? `?${s}` : "";
};

async function api(method, endpoint, body) {
	const res = await fetch(`${API}${endpoint}`, {
		method,
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* 保留 text */
	}
	return { status: res.status, json, text };
}

// ---------- 要上传的文件（只发运行时需要的，等价于 .vercelignore 的效果） ----------
const INCLUDE_DIRS = ["api"];
const INCLUDE_FILES = ["package.json", "vercel.json"];
function collectFiles() {
	const out = [];
	for (const dir of INCLUDE_DIRS) {
		const walk = (d, prefix) => {
			for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
				const rel = `${prefix}/${entry.name}`;
				if (entry.isDirectory()) walk(path.join(d, entry.name), rel);
				else out.push(rel);
			}
		};
		if (fs.existsSync(dir)) walk(path.join(ROOT, dir), dir);
	}
	for (const f of INCLUDE_FILES) if (fs.existsSync(path.join(ROOT, f))) out.push(f);
	return out;
}

const L = (s) => console.log(s);

// ---------- 1) 建项目 ----------
L(`\n=== 1) 项目 ${PROJECT}（scope: ${TEAM_ID || "个人"}）===`);
let project = null;
const created = await api("POST", `/v11/projects${qs()}`, { name: PROJECT, framework: null });
if (created.status === 200 || created.status === 201) {
	project = created.json;
	L(`  ✅ 已创建 (id=${project.id})`);
} else if (created.status === 409) {
	const existing = await api("GET", `/v9/projects/${PROJECT}${qs()}`);
	project = existing.json;
	L(`  ℹ️ 已存在，复用 (id=${project.id})`);
} else {
	L(`  ❌ 创建失败 ${created.status}: ${created.text.slice(0, 400)}`);
	process.exit(1);
}

// ---------- 2) 环境变量 ----------
// 只写"必需的 + 编码了明确产品决策的"。
// 其余一律交给代码内置默认值（等价值见 verify-defaults.mjs），少一份配置就少一处漂移。
//   SOURCE_TIMEOUT_MS / D2PASS_TIMEOUT_MS / TOTAL_BUDGET_MS / RATE_LIMIT_PER_MIN / BATCH_MAX
//   D2PASS_USE_RSC / PREVIEW_ENABLED / PREVIEW_VERIFY / NEGATIVE_TTL_HOURS  → 全部依赖默认值
// REDIS_URL 由控制台/Marketplace 集成注入，本脚本**不写也不删**（sensitive 类型，写了会覆盖）。
// debug=1 已改为无条件生效（接口由 API Key 保护），原来的 ALLOW_DEBUG 开关已移除。
L(`\n=== 2) 环境变量 ===`);
const envVars = [
	["API_KEY", process.env.D2PASS_API_KEY], // 必需：不配则接口完全公开
	// 用户明确要求：480p 优先；HEYZO 用最轻的 sample_low。留在面板里让决策可见。
	["PREVIEW_QUALITY_ORDER", process.env.PREVIEW_QUALITY_ORDER || "480p,360p,240p,720p,1080p"],
	["PREVIEW_HEYZO_ORDER", process.env.PREVIEW_HEYZO_ORDER || "sample_low,sample,sample_hd"],
];
for (const [key, value] of envVars) {
	if (value === undefined || value === "") {
		L(`  ⚠️ 跳过 ${key}（未提供值）`);
		continue;
	}
	const res = await api("POST", `/v10/projects/${project.id}/env${qs({ upsert: "true" })}`, {
		key,
		value,
		type: ["API_KEY"].includes(key) ? "encrypted" : "plain",
		target: ["production", "preview", "development"],
	});
	L(res.status < 300 ? `  ✅ ${key}` : `  ❌ ${key} -> ${res.status} ${res.text.slice(0, 200)}`);
}

// ---------- 3) 创建部署（内联文件） ----------
L(`\n=== 3) 创建生产部署（region=${REGION}）===`);
const files = collectFiles().map((rel) => ({
	file: rel,
	data: fs.readFileSync(path.join(ROOT, rel)).toString("base64"),
	encoding: "base64",
}));
L(`  文件 ${files.length} 个: ${files.map((f) => f.file).join(", ")}`);
L(`  体积 ${(files.reduce((n, f) => n + f.data.length, 0) / 1024).toFixed(0)} KB(base64)`);

const deploy = await api("POST", `/v13/deployments${qs({ forceNew: "1", skipAutoDetectionConfirmation: "1" })}`, {
	name: PROJECT,
	target: "production",
	files,
	regions: [REGION],
});
if (deploy.status >= 300) {
	L(`  ❌ 部署失败 ${deploy.status}: ${deploy.text.slice(0, 600)}`);
	process.exit(1);
}
const deploymentId = deploy.json.id;
L(`  ✅ 已创建 id=${deploymentId} url=${deploy.json.url}`);

// ---------- 4) 轮询 ----------
L(`\n=== 4) 等待构建 ===`);
let final = null;
for (let i = 0; i < 60; i++) {
	await new Promise((r) => setTimeout(r, 5000));
	const res = await api("GET", `/v13/deployments/${deploymentId}${qs()}`);
	const d = res.json;
	if (!d) continue;
	process.stdout.write(`  [${i + 1}] ${d.readyState}\r`);
	if (["READY", "ERROR", "CANCELED"].includes(d.readyState)) {
		final = d;
		break;
	}
}
L("");
if (!final) {
	L("  ⏱ 超时未完成，请到 Dashboard 查看");
	process.exit(1);
}
L(`  最终状态: ${final.readyState}`);
if (final.readyState !== "READY") {
	L(`  ❌ 构建失败: ${final.errorMessage || "见 Dashboard 日志"}`);
	process.exit(1);
}

const base = `https://${final.url}`;
L(`\n=== 部署完成 ===`);
L(`  URL: ${base}`);
L(`  别名: https://${PROJECT}.vercel.app`);
L(`\n下一步：node test/d2pass/smoke-prod.mjs ${base} <API_KEY>   （在仓库根执行）`);
