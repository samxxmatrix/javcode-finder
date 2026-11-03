/**
 * 进程内假 Redis：只服务于 tools/dmm-proxy-stub.mjs，让 handler 的缓存路径真正被跑到。
 *
 * 职责单一：RESP 服务端 + 命令日志 + 可预置的键值表。不实现 TTL / 淘汰 / 主从 / 事务 /
 * Pub/Sub / 数据库切换等真实 Redis 语义 —— 它只满足 handler 实际用到的那条最小路径：
 *   createClient({ url, socket: { connectTimeout: 3000, reconnectStrategy: false } })
 *   → connect() → get(key) → set(key, value) → destroy()
 *
 * 实测（安装的 redis@5.12.1，handler 未设 RESP 选项）：connect() 期间**不发 HELLO**，
 * 只管道化两条客户端标识命令：
 *   CLIENT SETINFO LIB-VER 5.12.1
 *   CLIENT SETINFO LIB-NAME node-redis
 * 这两条在 node-redis 里带 errorHandler（库明确容忍老版本 Redis 不支持它们而报错），
 * 所以 +OK 或 -ERR 都能连通；这里回 +OK（真 Redis ≥7.2 的行为，最接近生产）。
 * GET → 批量串 / 空批量串（$-1）；SET → +OK；连接期命令（CLIENT/AUTH/SELECT/READONLY）与
 * PING/DEL/QUIT 也各给真 Redis 的回复；**其余命令一律 -ERR**。
 * **每条命令都记进 commands**，未知命令也照记 —— 不允许任何一次缓存交互是静默的。
 *
 * 用法：
 *   const redis = await startFakeRedis({ seed: { "CID:IPTD-700": { ... } } });
 *   process.env.REDIS_URL = redis.url;
 *   ... redis.commands / redis.get(key) / redis.json(key) / redis.seed(map) / redis.flush() ...
 *   await redis.close();
 *
 * commands 是**活的**数组，元素形如 { name: "SET", args: ["BDSM-091", "{\"v\":2,...}"] }
 * （args 不含命令名，与 handler 调用的实参顺序一致；删元素用 commands.length = 0）。
 */

import net from "node:net";

const CRLF = "\r\n";

/** RESP 批量串（GET 的回复；不存在时是空批量串 $-1） */
function bulkReply(value) {
	if (value === null || value === undefined) return "$-1" + CRLF;
	const body = Buffer.from(String(value), "utf8");
	return Buffer.concat([Buffer.from(`$${body.length}` + CRLF, "utf8"), body, Buffer.from(CRLF, "utf8")]);
}

/**
 * 解析一条完整的 RESP 请求（客户端发来的都是「批量串数组」）。
 * 不完整返回 null（等下一个 data 事件再拼），完整返回 { args, rest }。
 */
function parseOneRequest(buf) {
	if (buf.length === 0) return null;
	if (buf[0] !== 0x2a) return null; // 非数组帧（如内联命令）：不支持，缓冲着不再前进
	const headerEnd = buf.indexOf(CRLF);
	if (headerEnd === -1) return null;
	const count = Number(buf.subarray(1, headerEnd).toString("utf8"));
	if (!Number.isInteger(count) || count <= 0) return null;

	let offset = headerEnd + 2;
	const args = [];
	for (let i = 0; i < count; i++) {
		if (offset >= buf.length || buf[offset] !== 0x24) return null; // '$'
		const lineEnd = buf.indexOf(CRLF, offset);
		if (lineEnd === -1) return null;
		const length = Number(buf.subarray(offset + 1, lineEnd).toString("utf8"));
		const start = lineEnd + 2;
		if (!Number.isInteger(length) || length < 0 || start + length + 2 > buf.length) return null;
		args.push(buf.subarray(start, start + length).toString("utf8"));
		offset = start + length + 2;
	}
	return { args, rest: buf.subarray(offset) };
}

/**
 * 启动假 Redis，监听 127.0.0.1 的随机空闲端口。
 * @param {{ seed?: Record<string, string | object> | Map<string, string | object> }} [options]
 *   seed：预置键值。值不是字符串就 JSON.stringify（与 handler 的 SET 写法一致）。
 * @returns {Promise<{
 *   url: string, port: number,
 *   commands: Array<{ name: string, args: string[] }>,
 *   entries: Map<string, string>,
 *   get: (key: string) => string | null,
 *   json: (key: string) => any,
 *   seed: (map: Record<string, string | object> | Map<string, string | object>) => void,
 *   flush: () => void,
 *   close: () => Promise<void>,
 * }>}
 */
export async function startFakeRedis({ seed = {} } = {}) {
	/** 解析后的键值状态：键 → 原样字符串（Redis 里就是字节串） */
	const entries = new Map();
	/** 活命令日志：{ name, args }（args 不含命令名） */
	const commands = [];
	const sockets = new Set();

	const put = (key, value) => {
		entries.set(String(key), typeof value === "string" ? value : JSON.stringify(value));
	};
	const seedEntries = (map) => {
		if (!map) return;
		const pairs = map instanceof Map ? map.entries() : Object.entries(map);
		for (const [key, value] of pairs) put(key, value);
	};
	seedEntries(seed);

	const reply = (socket, text) => {
		try {
			socket.write(text);
		} catch (err) {
			// 对端已断：丢掉即可，命令日志仍在
		}
	};

	const handleCommand = (socket, args) => {
		const name = String(args[0] ?? "").toUpperCase();
		commands.push({ name, args: args.slice(1) });
		switch (name) {
			case "GET": {
				const key = args[1];
				reply(socket, bulkReply(entries.has(String(key)) ? entries.get(String(key)) : null));
				return;
			}
			case "SET": {
				// 不实现 NX/XX/EX 等选项：handler 只发纯 SET key value
				entries.set(String(args[1]), String(args[2] ?? ""));
				reply(socket, "+OK" + CRLF);
				return;
			}
			case "DEL": {
				let removed = 0;
				for (const key of args.slice(1)) if (entries.delete(String(key))) removed += 1;
				reply(socket, ":" + removed + CRLF);
				return;
			}
			case "PING":
				reply(socket, "+PONG" + CRLF);
				return;
			case "QUIT":
				reply(socket, "+OK" + CRLF);
				socket.end();
				return;
			// 连接期命令：CLIENT SETINFO（node-redis 5）/ SETNAME / AUTH / SELECT / READONLY
			// 真 Redis 都回 +OK；回 -ERR 也能连通（node-redis 忽略这两条的失败），但 +OK 更贴近生产
			case "CLIENT":
			case "AUTH":
			case "SELECT":
			case "READONLY":
				reply(socket, "+OK" + CRLF);
				return;
			// HELLO 走未知命令分支（-ERR）：handler 没设 RESP 选项，实测不会发它。
			// 若将来有人显式开 RESP3，-ERR 会让 connect() 直接失败（响亮），而不是被假 +OK 骗过去。
			default:
				// 未知命令必须留下痕迹：既记进 commands，也回错误（不静默吞掉，也不假装成功）
				reply(socket, `-ERR unknown command '${name}'` + CRLF);
		}
	};

	const server = net.createServer((socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => {});
		let buffer = Buffer.alloc(0);
		socket.on("data", (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			for (;;) {
				const parsed = parseOneRequest(buffer);
				if (!parsed) break;
				buffer = parsed.rest;
				handleCommand(socket, parsed.args);
			}
		});
	});
	server.on("error", () => {});

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const port = server.address().port;

	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		// 先掐掉所有存活连接，再关监听：否则 server.close() 会等客户端自己断开
		// （handler 每次请求一建一毁，正常路径下这里通常已经是空集合）
		for (const socket of sockets) socket.destroy();
		sockets.clear();
		await new Promise((resolve) => server.close(() => resolve()));
	};

	const raw = (key) => (entries.has(String(key)) ? entries.get(String(key)) : null);

	return {
		url: `redis://127.0.0.1:${port}`,
		port,
		commands,
		entries,
		get: raw,
		/** 读回 handler 写进去的 JSON（写不进去 / 没写过就是 null） */
		json: (key) => {
			const value = raw(key);
			return value === null ? null : JSON.parse(value);
		},
		seed: seedEntries,
		flush: () => entries.clear(),
		close,
	};
}
