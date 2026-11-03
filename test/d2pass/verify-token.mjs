/**
 * 验证 Vercel token 并列出可用 scope（只读，不部署）。
 *
 *   node verify-token.mjs
 *
 * token 从 D:\VSCode\vercel-token.txt 第 2 行读取，**不打印内容**。
 */

import fs from "node:fs";

const TOKEN_FILE = "D:\\VSCode\\vercel-token.txt";
const token = fs
	.readFileSync(TOKEN_FILE, "utf8")
	.split(/\r?\n/)
	.map((s) => s.trim())
	.filter(Boolean)[1];

if (!token) {
	console.error("❌ 第 2 行为空");
	process.exit(1);
}
console.log(`token: ${token.slice(0, 4)}**** (${token.length} 字符)`);

const api = async (path, init = {}) => {
	const res = await fetch(`https://api.vercel.com${path}`, {
		...init,
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
	});
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* 保持 text */
	}
	return { status: res.status, json, text };
};

const user = await api("/v2/user");
console.log(`\nGET /v2/user -> ${user.status}`);
if (user.status !== 200) {
	console.log("  响应:", user.text.slice(0, 300));
	process.exit(1);
}
const u = user.json.user || user.json;
console.log(`  ✅ token 有效`);
console.log(`  username : ${u.username}`);
console.log(`  email    : ${u.email}`);
console.log(`  userId   : ${u.id}`);

const teams = await api("/v2/teams");
console.log(`\nGET /v2/teams -> ${teams.status}`);
const list = teams.json?.teams || [];
if (list.length === 0) {
	console.log("  （无 team，将部署到个人 scope）");
} else {
	for (const t of list) console.log(`  team: ${t.slug}  (id=${t.id}, name=${t.name})`);
}

const projects = await api("/v9/projects?limit=20");
console.log(`\nGET /v9/projects -> ${projects.status}`);
if (projects.status === 200) {
	const ps = projects.json.projects || [];
	console.log(`  现有项目 ${ps.length} 个:`);
	for (const p of ps.slice(0, 20)) {
		console.log(`    - ${p.name.padEnd(28)} region=${p.nodeVersion || "-"} framework=${p.framework || "-"}`);
	}
	const hit = ps.find((p) => p.name === "d2pass-api");
	console.log(hit ? `\n  ⚠️ 已存在同名项目 d2pass-api（复用时不会新建）` : `\n  ✅ 没有同名项目，可新建 d2pass-api`);
} else {
	console.log("  响应:", projects.text.slice(0, 200));
}
