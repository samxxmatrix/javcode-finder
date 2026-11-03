import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	RELEASES_PAGE_URL,
	UPDATE_CHECK_INTERVAL_MS,
	UPDATE_STATE_STORAGE_KEY,
	isNewerVersion,
	parseReleaseManifest,
	parseUpdateState,
	parseVersion,
	readUpdateState,
	resolveCheckOutcome,
	shouldCheckForUpdate,
	shouldShowUpdate,
	writeUpdateState,
} from "../../src/lib/release";

describe("parseVersion", () => {
	it("parses 1-4 numeric segments with an optional v prefix", () => {
		expect(parseVersion("2.1.0")).toEqual([2, 1, 0]);
		expect(parseVersion("v2.1.0")).toEqual([2, 1, 0]);
		expect(parseVersion("2.1")).toEqual([2, 1, 0]);
		expect(parseVersion("2")).toEqual([2, 0, 0]);
		expect(parseVersion("2.0.0.1")).toEqual([2, 0, 0, 1]);
		expect(parseVersion(" 2.1.0 ")).toEqual([2, 1, 0]);
	});

	it("rejects non-numeric, suffixed and over-long versions", () => {
		// Chrome manifest 的 version 只接受 1-4 段整数，预发布后缀一律不认
		expect(parseVersion("")).toBeNull();
		expect(parseVersion("abc")).toBeNull();
		expect(parseVersion("2.1.0-beta")).toBeNull();
		expect(parseVersion("2.0.0.1.2")).toBeNull();
		expect(parseVersion("2..1")).toBeNull();
	});
});

describe("isNewerVersion", () => {
	it("compares numerically instead of as strings", () => {
		// 字符串比较会把 "2.10.0" 判成小于 "2.9.9"
		expect(isNewerVersion("2.10.0", "2.9.9")).toBe(true);
		expect(isNewerVersion("2.1.0", "2.0.1")).toBe(true);
		expect(isNewerVersion("3.0.0", "2.99.99")).toBe(true);
	});

	it("is false for equal or older versions", () => {
		expect(isNewerVersion("2.0.1", "2.0.1")).toBe(false);
		expect(isNewerVersion("2.0.0", "2.0.0.0")).toBe(false);
		expect(isNewerVersion("1.9.9", "2.0.0")).toBe(false);
	});

	it("treats a 4th segment as newer", () => {
		expect(isNewerVersion("2.0.0.1", "2.0.0")).toBe(true);
	});

	it("is false when either side is unparsable", () => {
		expect(isNewerVersion("nope", "2.0.0")).toBe(false);
		expect(isNewerVersion("2.1.0", "")).toBe(false);
	});
});

describe("parseReleaseManifest", () => {
	it("accepts a valid asset and normalizes the version", () => {
		expect(
			parseReleaseManifest({
				version: "v2.1.0",
				url: "https://example.com/a.zip",
				notes: " 修了一堆 bug ",
			}),
		).toEqual({
			version: "2.1.0",
			url: "https://example.com/a.zip",
			notes: "修了一堆 bug",
		});
	});

	it("falls back to the releases page when url is missing or not https", () => {
		expect(parseReleaseManifest({ version: "2.1.0" })).toEqual({
			version: "2.1.0",
			url: RELEASES_PAGE_URL,
			notes: null,
		});
		expect(
			parseReleaseManifest({ version: "2.1.0", url: "http://x/a.zip" })?.url,
		).toBe(RELEASES_PAGE_URL);
	});

	it("returns null for missing or invalid version", () => {
		expect(parseReleaseManifest(null)).toBeNull();
		expect(parseReleaseManifest({})).toBeNull();
		expect(parseReleaseManifest({ version: 2 })).toBeNull();
		expect(parseReleaseManifest({ version: "beta" })).toBeNull();
	});
});

describe("resolveCheckOutcome", () => {
	const remote = { version: "2.2.0", url: RELEASES_PAGE_URL, notes: null };

	it("returns error when the response is missing or the request failed", () => {
		// 失败必须能与"已是最新"区分开：否则前端会误写 checkedAt，24h 内不再重试
		expect(resolveCheckOutcome(undefined, "2.1.0")).toEqual({
			status: "error",
			remote: null,
		});
		expect(resolveCheckOutcome({ ok: false, latest: null }, "2.1.0")).toEqual({
			status: "error",
			remote: null,
		});
	});

	it("reports update when the remote version is newer", () => {
		expect(resolveCheckOutcome({ ok: true, latest: remote }, "2.1.0")).toEqual({
			status: "update",
			remote,
		});
	});

	it("reports latest when the remote version is equal", () => {
		const same = { ...remote, version: "2.1.0" };
		expect(resolveCheckOutcome({ ok: true, latest: same }, "2.1.0")).toEqual({
			status: "latest",
			remote: same,
		});
	});

	it("reports latest when the remote version is older", () => {
		const older = { ...remote, version: "2.0.9" };
		expect(resolveCheckOutcome({ ok: true, latest: older }, "2.1.0")).toEqual({
			status: "latest",
			remote: older,
		});
	});

	it("treats ok without a manifest as an error instead of up-to-date", () => {
		expect(resolveCheckOutcome({ ok: true, latest: null }, "2.1.0")).toEqual({
			status: "error",
			remote: null,
		});
	});
});

describe("更新状态：24h 节流 + 关闭记忆", () => {
	let storageMock: Record<string, string>;

	beforeEach(() => {
		storageMock = {};
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => storageMock[key] ?? null,
			setItem: (key: string, value: string) => {
				storageMock[key] = value;
			},
			removeItem: (key: string) => {
				delete storageMock[key];
			},
			clear: () => {
				storageMock = {};
			},
		});
	});

	it("checks when never checked before", () => {
		expect(shouldCheckForUpdate(parseUpdateState(null), 1000)).toBe(true);
	});

	it("throttles within the interval and allows exactly at the boundary", () => {
		const state = { checkedAt: 1000, remote: null, dismissedVersion: null };
		expect(
			shouldCheckForUpdate(state, 1000 + UPDATE_CHECK_INTERVAL_MS - 1),
		).toBe(false);
		expect(shouldCheckForUpdate(state, 1000 + UPDATE_CHECK_INTERVAL_MS)).toBe(
			true,
		);
	});

	it("round-trips through storage and tolerates garbage", () => {
		const storage = localStorage as unknown as Storage;
		expect(readUpdateState(storage)).toEqual({
			checkedAt: null,
			remote: null,
			dismissedVersion: null,
		});

		const remote = { version: "2.1.0", url: RELEASES_PAGE_URL, notes: null };
		writeUpdateState(storage, {
			checkedAt: 42,
			remote,
			dismissedVersion: null,
		});
		expect(readUpdateState(storage)).toEqual({
			checkedAt: 42,
			remote,
			dismissedVersion: null,
		});

		storage.setItem(UPDATE_STATE_STORAGE_KEY, "{oops");
		expect(readUpdateState(storage)).toEqual({
			checkedAt: null,
			remote: null,
			dismissedVersion: null,
		});
	});

	it("reads legacy records that kept the remote release under latest", () => {
		// 旧版本把远端 manifest 存在 latest 字段；改名后必须仍能读出来，否则老用户会丢缓存
		const storage = localStorage as unknown as Storage;
		storage.setItem(
			UPDATE_STATE_STORAGE_KEY,
			JSON.stringify({
				checkedAt: 7,
				latest: { version: "2.2.0", url: RELEASES_PAGE_URL, notes: null },
				dismissedVersion: "2.1.0",
			}),
		);
		expect(readUpdateState(storage)).toEqual({
			checkedAt: 7,
			remote: { version: "2.2.0", url: RELEASES_PAGE_URL, notes: null },
			dismissedVersion: "2.1.0",
		});
	});

	it("does not announce a dismissed version, but announces a newer one", () => {
		const remote = { version: "2.1.0", url: RELEASES_PAGE_URL, notes: null };
		expect(
			shouldShowUpdate(
				{ checkedAt: 1, remote, dismissedVersion: null },
				"2.0.0",
			),
		).toBe(true);
		expect(
			shouldShowUpdate(
				{ checkedAt: 1, remote, dismissedVersion: "2.1.0" },
				"2.0.0",
			),
		).toBe(false);
		expect(
			shouldShowUpdate(
				{ checkedAt: 1, remote: null, dismissedVersion: null },
				"2.0.0",
			),
		).toBe(false);
		// 关了 2.1.0 之后又来 2.2.0，仍要提示
		expect(
			shouldShowUpdate(
				{
					checkedAt: 1,
					remote: { ...remote, version: "2.2.0" },
					dismissedVersion: "2.1.0",
				},
				"2.0.0",
			),
		).toBe(true);
	});

	it("does not announce a remote version that is not newer than the installed one", () => {
		// 远端 manifest 现在无条件缓存（设置页要显示版本号），所以提示条必须自己比版本
		const remote = { version: "2.1.0", url: RELEASES_PAGE_URL, notes: null };
		expect(
			shouldShowUpdate(
				{ checkedAt: 1, remote, dismissedVersion: null },
				"2.1.0",
			),
		).toBe(false);
		expect(
			shouldShowUpdate(
				{ checkedAt: 1, remote, dismissedVersion: null },
				"2.2.0",
			),
		).toBe(false);
	});
});
