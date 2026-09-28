import { describe, expect, it, vi } from "vitest";
import { destroyHlsInstance } from "../src/lib/hls-instance";

describe("destroyHlsInstance", () => {
	it("destroys and clears the current HLS instance", () => {
		const instance = { destroy: vi.fn() };
		const ref = { current: instance };

		destroyHlsInstance(ref);

		expect(instance.destroy).toHaveBeenCalledOnce();
		expect(ref.current).toBeNull();
	});
});
