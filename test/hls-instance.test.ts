import { describe, expect, it, vi } from "vitest";
import {
	destroyHlsInstance,
	destroyHlsBefore,
} from "../src/lib/hls-instance";

describe("destroyHlsInstance", () => {
	it("destroys and clears the current HLS instance", () => {
		const instance = { destroy: vi.fn() };
		const ref = { current: instance };

		destroyHlsInstance(ref);

		expect(instance.destroy).toHaveBeenCalledOnce();
		expect(ref.current).toBeNull();
	});

	it("destroys and clears HLS before starting the asynchronous fallback", async () => {
		const events: string[] = [];
		const ref = {
			current: {
				destroy: () => events.push("destroy"),
			},
		};

		await destroyHlsBefore(ref, async () => {
			expect(ref.current).toBeNull();
			events.push("fallback");
		});

		expect(events).toEqual(["destroy", "fallback"]);
	});
});
