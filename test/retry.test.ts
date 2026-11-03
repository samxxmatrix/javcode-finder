import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../src/lib/retry";

describe("withRetry", () => {
	it("returns the first result without retrying on success", async () => {
		const operation = vi.fn().mockResolvedValue("ok");

		await expect(withRetry(operation, { attempts: 2 })).resolves.toBe("ok");
		expect(operation).toHaveBeenCalledTimes(1);
	});

	it("retries once and returns the later success", async () => {
		const operation = vi
			.fn()
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce("ok");

		await expect(withRetry(operation, { attempts: 2 })).resolves.toBe("ok");
		expect(operation).toHaveBeenCalledTimes(2);
	});

	it("throws the last error after exhausting attempts", async () => {
		const first = new Error("first");
		const last = new Error("last");
		const operation = vi
			.fn()
			.mockRejectedValueOnce(first)
			.mockRejectedValueOnce(last);

		await expect(withRetry(operation, { attempts: 2 })).rejects.toBe(last);
		expect(operation).toHaveBeenCalledTimes(2);
	});

	it("retries once by default", async () => {
		const operation = vi
			.fn()
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce("ok");

		await expect(withRetry(operation)).resolves.toBe("ok");
		expect(operation).toHaveBeenCalledTimes(2);
	});

	it("honours a single attempt when attempts is 1", async () => {
		const operation = vi.fn().mockRejectedValue(new Error("boom"));

		await expect(withRetry(operation, { attempts: 1 })).rejects.toThrow("boom");
		expect(operation).toHaveBeenCalledTimes(1);
	});

	it("treats non-positive attempts as a single attempt", async () => {
		const operation = vi.fn().mockRejectedValue(new Error("boom"));

		await expect(withRetry(operation, { attempts: 0 })).rejects.toThrow("boom");
		expect(operation).toHaveBeenCalledTimes(1);
	});

	it("passes the 1-based attempt number so callers can vary per-attempt timeouts", async () => {
		const operation = vi
			.fn()
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce("ok");

		await expect(withRetry(operation, { attempts: 2 })).resolves.toBe("ok");
		expect(operation).toHaveBeenNthCalledWith(1, 1);
		expect(operation).toHaveBeenNthCalledWith(2, 2);
	});
});
