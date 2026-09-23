import { describe, expect, it, vi } from "vitest";
import {
	checkForUpdate,
	EXTENSION_VERSION,
	isNewerVersion,
	LATEST_RELEASE_API_URL,
} from "../src/lib/release";

describe("release updates", () => {
	it("compares stable semantic versions", () => {
		expect(isNewerVersion("v2.1.0")).toBe(true);
		expect(isNewerVersion("2.0.1")).toBe(true);
		expect(isNewerVersion("2.0.0")).toBe(false);
		expect(isNewerVersion("1.9.9")).toBe(false);
		expect(isNewerVersion("v2.0.0-beta")).toBe(false);
	});

	it("returns a newer latest GitHub release", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ tag_name: "v2.1.0" }),
		});

		await expect(checkForUpdate(fetchMock)).resolves.toMatchObject({
			version: "2.1.0",
		});
		expect(fetchMock).toHaveBeenCalledWith(
			LATEST_RELEASE_API_URL,
			expect.objectContaining({ cache: "no-store" }),
		);
	});

	it("does not show an update for the installed or invalid version", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ tag_name: `v${EXTENSION_VERSION}` }),
		});

		await expect(checkForUpdate(fetchMock)).resolves.toBeNull();
		await expect(
			checkForUpdate(
				vi.fn().mockResolvedValue({
					ok: true,
					json: async () => ({ tag_name: "latest" }),
				}),
			),
		).resolves.toBeNull();
	});

	it("fails silently when GitHub cannot be reached", async () => {
		await expect(checkForUpdate(vi.fn().mockRejectedValue(new Error("offline")))).resolves.toBeNull();
	});
});
