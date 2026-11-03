import { describe, expect, it } from "vitest";
import {
	PERFORMER_TRANSLATE_CONCURRENCY,
	buildMetaRow,
} from "../../src/lib/preview-meta";

describe("buildMetaRow", () => {
	it("封面层在渲染 + idle + 有数据 → 显示，并给出空格连接的两段文本", () => {
		expect(
			buildMetaRow({
				playbackStatus: "idle",
				coverLayerVisible: true,
				performers: ["柏木雫", "吉高寧々"],
				translations: {},
				releaseDate: "2026-10-02",
			}),
		).toEqual({
			show: true,
			performersText: "柏木雫 吉高寧々",
			fullNames: "柏木雫 吉高寧々",
			releaseDate: "2026-10-02",
		});
	});

	it("译文逐个替换；空白译文回退原名", () => {
		const row = buildMetaRow({
			playbackStatus: "idle",
			coverLayerVisible: true,
			performers: ["柏木雫", "吉高寧々"],
			translations: { 柏木雫: "柏木雫（译）", 吉高寧々: "   " },
			releaseDate: null,
		});
		expect(row.performersText).toBe("柏木雫（译） 吉高寧々");
		expect(row.fullNames).toBe("柏木雫 吉高寧々");
	});

	it("播放中 / 加载中 / 播放失败 / 封面层不渲染 → 不显示", () => {
		const base = {
			coverLayerVisible: true,
			performers: ["柏木雫"],
			translations: {},
			releaseDate: "2026-10-02",
		} as const;
		expect(buildMetaRow({ ...base, playbackStatus: "loading" }).show).toBe(false);
		expect(buildMetaRow({ ...base, playbackStatus: "playing" }).show).toBe(false);
		expect(buildMetaRow({ ...base, playbackStatus: "failed" }).show).toBe(false);
		expect(
			buildMetaRow({ ...base, playbackStatus: "idle", coverLayerVisible: false })
				.show,
		).toBe(false);
	});

	it("只有日期时也显示（日期贴右由 CSS 的 margin-left:auto 负责）", () => {
		expect(
			buildMetaRow({
				playbackStatus: "idle",
				coverLayerVisible: true,
				performers: [],
				translations: {},
				releaseDate: "2026-10-02",
			}),
		).toEqual({
			show: true,
			performersText: "",
			fullNames: "",
			releaseDate: "2026-10-02",
		});
	});

	it("两样都没有 → 不显示", () => {
		expect(
			buildMetaRow({
				playbackStatus: "idle",
				coverLayerVisible: true,
				performers: [],
				translations: {},
				releaseDate: null,
			}).show,
		).toBe(false);
	});
});

describe("PERFORMER_TRANSLATE_CONCURRENCY", () => {
	it("是 4（保护 Worker：名字多时也不一次放出去）", () => {
		expect(PERFORMER_TRANSLATE_CONCURRENCY).toBe(4);
	});
});
