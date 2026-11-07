import { describe, expect, it } from "vitest";
import { SETTINGS_FILE_NAME, joinWebdavUrl } from "../../src/lib/favorites";
import { DEFAULT_SETTINGS, type ExtensionSettings } from "../../src/lib/settings";
import {
	decideCloudSettingsAction,
	isPristineSettings,
	mergeCloudSettings,
	parseCloudSettings,
	serializeCloudSettings,
} from "../../src/lib/settings-sync";

const customSettings: ExtensionSettings = {
	...DEFAULT_SETTINGS,
	supjavName: "Supjav",
	supjavTemplate: "https://example.com/search?q={code}",
	apiUrl: "https://proxy.example.com/",
	apiKey: "proxy-key",
	lookupEnabled: true,
	previewVolume: 40,
	excludedHosts: ["example.org"],
};

describe("joinWebdavUrl with settings file", () => {
	it("appends settings.json next to favorites.json", () => {
		expect(joinWebdavUrl("https://dav.example.com/dav/app/", SETTINGS_FILE_NAME)).toBe(
			"https://dav.example.com/dav/app/settings.json",
		);
		expect(SETTINGS_FILE_NAME).toBe("settings.json");
	});
});

describe("serializeCloudSettings", () => {
	const payload = JSON.parse(
		serializeCloudSettings(customSettings, "zh-hant", 1700000000000),
	) as {
		version: number;
		updatedAt: number;
		locale: string;
		settings: Record<string, unknown>;
	};

	it("wraps settings in a versioned envelope with locale and timestamp", () => {
		expect(payload.version).toBe(1);
		expect(payload.updatedAt).toBe(1700000000000);
		expect(payload.locale).toBe("zh-hant");
	});

	it("backs up functional settings", () => {
		expect(payload.settings.supjavName).toBe("Supjav");
		expect(payload.settings.supjavTemplate).toBe(
			"https://example.com/search?q={code}",
		);
		expect(payload.settings.apiKey).toBe("proxy-key");
		expect(payload.settings.lookupEnabled).toBe(true);
		expect(payload.settings.previewVolume).toBe(40);
		expect(payload.settings.excludedHosts).toEqual(["example.org"]);
	});

	it("never uploads the WebDAV connection itself", () => {
		const body = serializeCloudSettings(
			{
				...customSettings,
				webdavUrl: "https://dav.example.com/dav/app/",
				webdavUser: "user@example.com",
				webdavPass: "s3cret",
				webdavEnabled: true,
			},
			"en",
		);
		expect(body).not.toContain("s3cret");
		const parsed = JSON.parse(body) as { settings: Record<string, unknown> };
		expect(parsed.settings.webdavPass).toBe("");
		expect(parsed.settings.webdavUrl).toBe("");
		expect(parsed.settings.webdavUser).toBe("");
		expect(parsed.settings.webdavEnabled).toBe(false);
	});
});

describe("parseCloudSettings", () => {
	it("normalizes a valid payload", () => {
		const cloud = parseCloudSettings({
			version: 1,
			updatedAt: 1700000000000,
			locale: "en",
			settings: { supjavName: "Supjav", apiKey: "key" },
		});
		expect(cloud?.locale).toBe("en");
		expect(cloud?.updatedAt).toBe(1700000000000);
		expect(cloud?.settings.supjavName).toBe("Supjav");
		expect(cloud?.settings.apiKey).toBe("key");
		// 缺失字段回落到默认值，而不是留空
		expect(cloud?.settings.customRegex).toBe(DEFAULT_SETTINGS.customRegex);
		expect(cloud?.settings.falenoPrefixes).toEqual(DEFAULT_SETTINGS.falenoPrefixes);
	});

	it("rejects payloads without a settings object", () => {
		expect(parseCloudSettings(null)).toBeNull();
		expect(parseCloudSettings("nope")).toBeNull();
		expect(parseCloudSettings({})).toBeNull();
		expect(parseCloudSettings({ settings: "nope" })).toBeNull();
	});

	it("falls back to auto locale and unknown timestamp", () => {
		const cloud = parseCloudSettings({ settings: {}, locale: "fr", updatedAt: -5 });
		expect(cloud?.locale).toBe("auto");
		expect(cloud?.updatedAt).toBe(0);
	});
});

describe("isPristineSettings", () => {
	it("treats the default configuration as pristine", () => {
		expect(isPristineSettings(DEFAULT_SETTINGS)).toBe(true);
	});

	it("ignores the WebDAV connection details", () => {
		expect(
			isPristineSettings({
				...DEFAULT_SETTINGS,
				webdavUrl: "https://dav.example.com/dav/app/",
				webdavUser: "user@example.com",
				webdavPass: "pass",
				webdavEnabled: true,
			}),
		).toBe(true);
	});

	it("detects any customized setting", () => {
		expect(
			isPristineSettings({ ...DEFAULT_SETTINGS, supjavName: "Supjav" }),
		).toBe(false);
		expect(isPristineSettings({ ...DEFAULT_SETTINGS, previewVolume: 50 })).toBe(
			false,
		);
	});
});

describe("decideCloudSettingsAction", () => {
	const cloud = parseCloudSettings({
		version: 1,
		settings: { supjavName: "Supjav" },
	});

	it("pushes when the cloud has no settings file", () => {
		expect(decideCloudSettingsAction(null, DEFAULT_SETTINGS)).toBe("push");
	});

	it("pulls when local settings are still pristine", () => {
		expect(decideCloudSettingsAction(cloud, DEFAULT_SETTINGS)).toBe("pull");
	});

	it("asks the user when both sides are customized", () => {
		expect(decideCloudSettingsAction(cloud, customSettings)).toBe("conflict");
	});
});

describe("mergeCloudSettings", () => {
	it("applies cloud settings but keeps the verified connection", () => {
		const cloud = parseCloudSettings({
			version: 1,
			locale: "en",
			settings: { supjavName: "Supjav", previewVolume: 30 },
		});
		expect(cloud).not.toBeNull();
		const merged = mergeCloudSettings(cloud!, {
			url: "https://dav.example.com/dav/app/",
			user: "user@example.com",
			pass: "pass",
		});
		expect(merged.supjavName).toBe("Supjav");
		expect(merged.previewVolume).toBe(30);
		expect(merged.webdavUrl).toBe("https://dav.example.com/dav/app/");
		expect(merged.webdavUser).toBe("user@example.com");
		expect(merged.webdavPass).toBe("pass");
		expect(merged.webdavEnabled).toBe(true);
	});
});

// QA 补充：新增的「删除收藏」开关必须随配置备份往返（云端恢复后不能丢）
describe("embyDropFavoritesInLibrary cloud round-trip", () => {
	it("serializes the flag and restores it on parse", () => {
		const body = serializeCloudSettings(
			{ ...customSettings, embyDropFavoritesInLibrary: true },
			"en",
			1700000000000,
		);
		const cloud = parseCloudSettings(JSON.parse(body));
		expect(cloud?.settings.embyDropFavoritesInLibrary).toBe(true);
	});

	it("falls back to false for older cloud files without the field", () => {
		const cloud = parseCloudSettings({
			version: 1,
			locale: "en",
			settings: { supjavName: "Supjav" },
		});
		expect(cloud?.settings.embyDropFavoritesInLibrary).toBe(false);
	});

	it("mergeCloudSettings keeps the cloud value", () => {
		const cloud = parseCloudSettings({
			version: 1,
			locale: "en",
			settings: { embyDropFavoritesInLibrary: true },
		});
		const merged = mergeCloudSettings(cloud!, {
			url: "https://dav.example.com/dav/app/",
			user: "user@example.com",
			pass: "pass",
		});
		expect(merged.embyDropFavoritesInLibrary).toBe(true);
	});
});
