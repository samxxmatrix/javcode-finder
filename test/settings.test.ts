import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_SETTINGS,
	getEffectiveLocale,
	getSavedLocale,
	getSettings,
	isHostExcluded,
	isValidRegex,
	normalizeDomain,
	resetSettings,
	resolveSearchUrl,
	resolveSupjavUrl,
	saveLocale,
	saveSettings,
	SETTINGS_STORAGE_KEY,
} from "../src/lib/settings";

describe("settings", () => {
	let storageMock: Record<string, string> = {};

	beforeEach(() => {
		storageMock = {};
		vi.stubGlobal("localStorage", {
			getItem: vi.fn((key: string) => storageMock[key] ?? null),
			setItem: vi.fn((key: string, val: string) => {
				storageMock[key] = val;
			}),
			removeItem: vi.fn((key: string) => {
				delete storageMock[key];
			}),
			clear: vi.fn(() => {
				storageMock = {};
			}),
		});
	});

	it("returns default settings when localStorage is empty", () => {
		const settings = getSettings();
		expect(settings).toEqual(DEFAULT_SETTINGS);
	});

	it("saves and retrieves custom templates", () => {
		saveSettings({
			supjavTemplate: "https://custom.example.com/{code}",
			javbusTemplate: "https://www.javbus.com/{code}",
		});

		const saved = getSettings();
		expect(saved.supjavTemplate).toBe("https://custom.example.com/{code}");
		expect(saved.javbusTemplate).toBe("https://www.javbus.com/{code}");
	});

	it("saves an empty supjav template (means follow locale)", () => {
		saveSettings({ supjavTemplate: "https://custom.example.org/{code}" });
		saveSettings({ supjavTemplate: "" });
		expect(getSettings().supjavTemplate).toBe("");
	});

	it("saves and restores custom button names", () => {
		saveSettings({
			supjavName: "Supjav2",
			javdbName: "DB",
		});
		expect(getSettings().supjavName).toBe("Supjav2");
		expect(getSettings().javdbName).toBe("DB");

		// 清空名称 → 回退默认名称
		saveSettings({ supjavName: "", javdbName: "" });
		expect(getSettings().supjavName).toBe(DEFAULT_SETTINGS.supjavName);
		expect(getSettings().javdbName).toBe(DEFAULT_SETTINGS.javdbName);
	});

	it("saves and restores WebDAV cloud settings", () => {
		saveSettings({
			webdavUrl: "https://dav.jianguoyun.com/dav/javcodefinder/",
			webdavUser: "user@example.com",
			webdavPass: "secret",
		});
		const saved = getSettings();
		expect(saved.webdavUrl).toBe("https://dav.jianguoyun.com/dav/javcodefinder/");
		expect(saved.webdavUser).toBe("user@example.com");
		expect(saved.webdavPass).toBe("secret");

		// 清空 → 回默认空（关闭云端同步）
		saveSettings({ webdavUrl: "", webdavUser: "", webdavPass: "" });
		expect(getSettings().webdavUrl).toBe("");
		expect(getSettings().webdavUser).toBe("");
		expect(getSettings().webdavPass).toBe("");
	});

	it("custom platform is empty by default and saved when configured", () => {
		// 无默认配置：名称与模板默认均为空
		expect(DEFAULT_SETTINGS.customName).toBe("");
		expect(DEFAULT_SETTINGS.customTemplate).toBe("");
		expect(getSettings().customName).toBe("");
		expect(getSettings().customTemplate).toBe("");

		saveSettings({
			customName: "MySite",
			customTemplate: "https://mysite.example.com/search/{code}",
		});
		expect(getSettings().customName).toBe("MySite");
		expect(getSettings().customTemplate).toBe(
			"https://mysite.example.com/search/{code}",
		);

		// 清空 → 回默认空（面板隐藏该平台按钮）
		saveSettings({ customName: "", customTemplate: "" });
		expect(getSettings().customName).toBe("");
		expect(getSettings().customTemplate).toBe("");
	});

	it("translate worker settings default off with empty URL and can be saved", () => {
		// 默认：开关关闭、地址为空（关闭时直接用谷歌翻译）
		expect(DEFAULT_SETTINGS.translateEnabled).toBe(false);
		expect(DEFAULT_SETTINGS.translateApiUrl).toBe("");
		expect(getSettings().translateEnabled).toBe(false);
		expect(getSettings().translateApiUrl).toBe("");

		saveSettings({
			translateEnabled: true,
			translateApiUrl: "https://deepl.samwu00.de5.net/",
		});
		expect(getSettings().translateEnabled).toBe(true);
		expect(getSettings().translateApiUrl).toBe("https://deepl.samwu00.de5.net/");

		// 清空地址与关闭开关 → 回默认（纯谷歌模式）
		saveSettings({ translateEnabled: false, translateApiUrl: "" });
		expect(getSettings().translateEnabled).toBe(false);
		expect(getSettings().translateApiUrl).toBe("");
	});

	it("webdav enable switch defaults off and can be saved", () => {
		// 默认：云盘同步开关关闭（打开才存取）
		expect(DEFAULT_SETTINGS.webdavEnabled).toBe(false);
		expect(getSettings().webdavEnabled).toBe(false);

		saveSettings({ webdavEnabled: true });
		expect(getSettings().webdavEnabled).toBe(true);

		saveSettings({ webdavEnabled: false });
		expect(getSettings().webdavEnabled).toBe(false);
	});

	it("resets to default settings", () => {
		saveSettings({
			supjavTemplate: "https://custom.example.org/{code}",
		});
		expect(getSettings().supjavTemplate).toBe(
			"https://custom.example.org/{code}",
		);

		resetSettings();
		expect(getSettings()).toEqual(DEFAULT_SETTINGS);
	});

	describe("migration from legacy templates", () => {
		it("keeps a user-customized legacy missav template", () => {
			storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({
				missavTemplate: "https://custom.missav.ai/{code}",
			});
			expect(getSettings().supjavTemplate).toBe(
				"https://custom.missav.ai/{code}",
			);
		});

		it("keeps a user-customized legacy javtrailers template", () => {
			storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({
				javtrailersTemplate: "https://custom.jt.example/{code}",
			});
			expect(getSettings().supjavTemplate).toBe(
				"https://custom.jt.example/{code}",
			);
		});

		it("falls back to the new default when legacy values equal old defaults", () => {
			storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({
				missavTemplate: "https://missav.ws/cn/{code}",
				javtrailersTemplate: "https://javtrailers.com/search/{code}",
			});
			expect(getSettings().supjavTemplate).toBe(
				DEFAULT_SETTINGS.supjavTemplate,
			);
		});

		it("prefers the new field when present", () => {
			storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({
				missavTemplate: "https://custom.missav.ai/{code}",
				javtrailersTemplate: "https://custom.jt.example/{code}",
				supjavTemplate: "https://supjav.com/zh/?s={code}",
			});
			expect(getSettings().supjavTemplate).toBe(
				"https://supjav.com/zh/?s={code}",
			);
		});
	});

	describe("resolveSupjavUrl", () => {
		it("uses the zh template for zh-hans and zh-hant locales", () => {
			expect(resolveSupjavUrl("", "DLDSS-547", "zh-hans")).toBe(
				"https://supjav.com/zh/?s=DLDSS-547",
			);
			expect(resolveSupjavUrl("", "DLDSS-547", "zh-hant")).toBe(
				"https://supjav.com/zh/?s=DLDSS-547",
			);
		});

		it("uses the plain template for the en locale", () => {
			expect(resolveSupjavUrl("", "DLDSS-547", "en")).toBe(
				"https://supjav.com/?s=DLDSS-547",
			);
		});

		it("prefers a user-customized template over locale defaults", () => {
			expect(
				resolveSupjavUrl("https://custom.example/{code}", "DLDSS-547", "zh-hans"),
			).toBe("https://custom.example/DLDSS-547");
		});
	});

	describe("resolveSearchUrl", () => {
		it("replaces {code} placeholder", () => {
			const url = resolveSearchUrl(
				"https://javtrailers.com/search/{code}",
				"ABP-123",
			);
			expect(url).toBe("https://javtrailers.com/search/ABP-123");
		});

		it("replaces {番号} placeholder", () => {
			const url = resolveSearchUrl(
				"https://javdb.com/search?q={番号}",
				"SNIS-456",
			);
			expect(url).toBe("https://javdb.com/search?q=SNIS-456");
		});

		it("appends code when template has trailing slash", () => {
			const url = resolveSearchUrl("https://www.javbus.com/", "SSIS-001");
			expect(url).toBe("https://www.javbus.com/SSIS-001");
		});

		it("appends code when template has trailing equals", () => {
			const url = resolveSearchUrl("https://example.com/search?k=", "FC2-123");
			expect(url).toBe("https://example.com/search?k=FC2-123");
		});
	});

	describe("locale settings", () => {
		it("defaults to auto when storage is empty", () => {
			expect(getSavedLocale()).toBe("auto");
		});

		it("saves and retrieves locale preference", () => {
			saveLocale("zh-hant");
			expect(getSavedLocale()).toBe("zh-hant");
			saveLocale("en");
			expect(getSavedLocale()).toBe("en");
			saveLocale("auto");
			expect(getSavedLocale()).toBe("auto");
		});

		it("resolves effective locale properly", () => {
			expect(getEffectiveLocale("zh-hans")).toBe("zh-hans");
			expect(getEffectiveLocale("zh-hant")).toBe("zh-hant");
			expect(getEffectiveLocale("en")).toBe("en");
			// auto falls back to detectLocale (which uses navigator or 'en')
			expect(["zh-hans", "zh-hant", "en"]).toContain(getEffectiveLocale("auto"));
		});
	});

	describe("domain normalization and host exclusion", () => {
		it("normalizes domains properly", () => {
			expect(normalizeDomain("https://javranking.cc/zh-hans/")).toBe("javranking.cc");
			expect(normalizeDomain("http://SUB.Example.COM:8080/path?q=1")).toBe("sub.example.com");
			expect(normalizeDomain("  foo.bar.org  ")).toBe("foo.bar.org");
		});

		it("correctly identifies excluded hosts and subdomains", () => {
			const excluded = ["javranking.cc", "google.com"];
			expect(isHostExcluded("https://javranking.cc/search", excluded)).toBe(true);
			expect(isHostExcluded("https://static.javranking.cc/cover.jpg", excluded)).toBe(true);
			expect(isHostExcluded("https://sub.sub.google.com/test", excluded)).toBe(true);
			expect(isHostExcluded("https://notjavranking.cc/", excluded)).toBe(false);
			expect(isHostExcluded("https://example.org/", excluded)).toBe(false);
		});
	});

	describe("regex validation and custom regex settings", () => {
		it("validates regex patterns", () => {
			expect(isValidRegex("\\b[A-Za-z][A-Za-z0-9]{2,5}[-—–\\s]+\\d{3,6}\\b")).toBe(true);
			expect(isValidRegex("[A-Z]+-\\d+")).toBe(true);
			expect(isValidRegex("[unclosed-group")).toBe(false);
			expect(isValidRegex("")).toBe(false);
		});

		it("saves and restores custom regex and excluded hosts", () => {
			saveSettings({
				excludedHosts: ["custom-site.org", "javranking.cc"],
				customRegex: "\\bFC2[-_\\s]+\\d+\\b",
			});

			const s = getSettings();
			expect(s.excludedHosts).toContain("custom-site.org");
			expect(s.excludedHosts).toContain("javranking.cc");
			expect(s.customRegex).toBe("\\bFC2[-_\\s]+\\d+\\b");

			resetSettings();
			const reset = getSettings();
			expect(reset.excludedHosts).toEqual(DEFAULT_SETTINGS.excludedHosts);
			expect(reset.customRegex).toBe(DEFAULT_SETTINGS.customRegex);
		});
	});
});
