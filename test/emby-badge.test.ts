import { describe, expect, it } from "vitest";
import {
	EMBY_BADGE_GREEN_PATH,
	EMBY_BADGE_VIEW_BOX,
	EMBY_BADGE_WHITE_PATH,
	embyBadgeSvg,
} from "../src/lib/emby-badge";

describe("embyBadgeSvg", () => {
	it("生成页面标记用的 Emby 图标，尺寸随调用方（页面用 1em 跟字号）", () => {
		const svg = embyBadgeSvg("1em");

		expect(svg).toContain(`viewBox="${EMBY_BADGE_VIEW_BOX}"`);
		expect(svg).toContain('width="1em"');
		expect(svg).toContain('height="1em"');
		expect(svg).toContain(EMBY_BADGE_GREEN_PATH);
		expect(svg).toContain(EMBY_BADGE_WHITE_PATH);
		// 面板同款配色：绿星 + 白色播放三角（evenodd 挖空）
		expect(svg).toContain('fill="#06B831"');
		expect(svg).toContain('fill-rule="evenodd"');
		expect(svg).toContain('fill="#FFFFFF"');
		// 白色底块必须画在绿星之前，否则会盖住星形
		expect(svg.indexOf(EMBY_BADGE_WHITE_PATH)).toBeLessThan(
			svg.indexOf(EMBY_BADGE_GREEN_PATH),
		);
	});

	it("保留面板图标的原始 path 与 viewBox（迁移到共享常量时不许改形）", () => {
		expect(EMBY_BADGE_VIEW_BOX).toBe("155 155 714 714");
		expect(EMBY_BADGE_WHITE_PATH).toBe(
			"M385.60768 361.14432h292.64896v296.27392H385.60768z",
		);
		expect(EMBY_BADGE_GREEN_PATH).toBe(
			"M476.30336 155.01312L297.80992 333.50656l35.69664 35.69664-178.49344 178.49344 178.49344 178.49344 35.69664-35.69664 178.49344 178.49344 178.49344-178.49344-35.69664-35.69664 178.49344-178.49344-178.49344-178.49344-35.69664 35.69664-178.49344-178.49344m-35.69664 232.0384L654.7968 512 440.60672 636.94848V387.06176z",
		);
	});
});
