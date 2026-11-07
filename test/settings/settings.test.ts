import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	configSignature,
	DEFAULT_CODE_REGEX,
	DEFAULT_SETTINGS,
	type ExtensionSettings,
	getEffectiveLocale,
	getSavedLocale,
	getSettings,
	normalizeSettings,
	isHostExcluded,
	isPlatformConfigured,
	isValidRegex,
	normalizeDomain,
	resetSettings,
	resolveSearchUrl,
	saveLocale,
	saveSettings,
	SETTINGS_STORAGE_KEY,
} from "../../src/lib/settings";
import { toExternalSearchCode } from "../../src/lib/normalize-code";
import type { FallbackService } from "../../src/lib/translate";

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

	it("反代地址与 Key 与排除正则：默认值、保存、读回、trim", () => {
		expect(DEFAULT_SETTINGS.apiUrl).toBe("");
		expect(DEFAULT_SETTINGS.apiKey).toBe("");
		expect(DEFAULT_SETTINGS.lookupEnabled).toBe(false);
		expect(DEFAULT_SETTINGS.codeExcludeRegex).toBe("");

		saveSettings({
			apiUrl: "  https://proxy.example.com/  ",
			apiKey: "  key-123  ",
			lookupEnabled: true,
			codeExcludeRegex: "  HEYZO|3dw  ",
		});

		const saved = getSettings();
		expect(saved.apiUrl).toBe("https://proxy.example.com/");
		expect(saved.apiKey).toBe("key-123");
		expect(saved.lookupEnabled).toBe(true);
		expect(saved.codeExcludeRegex).toBe("HEYZO|3dw");
	});

	it("非法排除正则不保存（保留原值），留空 = 不排除", () => {
		saveSettings({ codeExcludeRegex: "^HEYZO-" });
		// 非法：saveSettings 直接丢弃这次输入，旧值不变
		saveSettings({ codeExcludeRegex: "([bad" });
		expect(getSettings().codeExcludeRegex).toBe("^HEYZO-");
		// 留空是合法值（= 不排除）
		saveSettings({ codeExcludeRegex: "" });
		expect(getSettings().codeExcludeRegex).toBe("");
	});

	it("读回时挡住手工写坏存储的非法排除正则", () => {
		storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({
			codeExcludeRegex: "([bad",
		});
		expect(getSettings().codeExcludeRegex).toBe("");
	});

	it("旧字段 uncensoredExcludeRegex 迁移到 codeExcludeRegex（升级不丢规则）", () => {
		// 仅存在旧键 ⇒ 迁移到新键（含 trim 与合法性校验）
		storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({
			uncensoredExcludeRegex: "  ^HEYZO-  ",
		});
		expect(getSettings().codeExcludeRegex).toBe("^HEYZO-");
		// 新旧键并存 ⇒ 新键优先，旧键不得覆盖
		storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({
			codeExcludeRegex: "^NEW-",
			uncensoredExcludeRegex: "^OLD-",
		});
		expect(getSettings().codeExcludeRegex).toBe("^NEW-");
	});

	it("读回时对手工写坏存储的反代字段做 trim", () => {
		// 绕过 saveSettings 直接落盘（模拟外部写坏/旧版残留）：trim 必须由读取端兜住
		storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({
			apiUrl: "  https://example.com  ",
			apiKey: "  key-123  ",
			codeExcludeRegex: "  HEYZO|3dw  ",
		});
		const settings = getSettings();
		expect(settings.apiUrl).toBe("https://example.com");
		expect(settings.apiKey).toBe("key-123");
		expect(settings.codeExcludeRegex).toBe("HEYZO|3dw");
	});

	it("旧版 DMM / D2PASS 字段一律忽略（合并后只认单一地址）", () => {
		// 一刀切迁移：旧值无法判断该映射到哪个前缀，宁可让用户重填也不要猜错
		storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({
			dmmApiUrl: "https://old-dmm.example.com/",
			dmmApiKey: "old-key",
			dmmEnabled: true,
			d2passApiUrl: "https://old-d2p.example.com/",
			d2passApiKey: "old-key-2",
			d2passEnabled: true,
		});
		const settings = getSettings();
		expect(settings.apiUrl).toBe("");
		expect(settings.apiKey).toBe("");
		expect(settings.lookupEnabled).toBe(false);
	});

	it("ignores a non-string proxy URL instead of dropping the whole save", () => {
		// 外部传入 null 时只有该字段回退原值，其余字段照常落盘（不能抛错吞掉整次保存）
		saveSettings({ apiUrl: "https://keep.example/" });
		saveSettings({ supjavName: "Z", apiUrl: null as unknown as string });
		expect(getSettings().supjavName).toBe("Z");
		expect(getSettings().apiUrl).toBe("https://keep.example/");
	});

	it("ignores non-string proxy key and exclude regex instead of dropping the whole save", () => {
		// 与 apiUrl 同口径：非字符串一律保留旧值，合法字段照常落盘
		saveSettings({
			apiKey: "keep-key",
			codeExcludeRegex: "^HEYZO-",
		});
		saveSettings({
			supjavName: "Z",
			apiKey: null as unknown as string,
			codeExcludeRegex: null as unknown as string,
		});
		expect(getSettings().supjavName).toBe("Z");
		expect(getSettings().apiKey).toBe("keep-key");
		expect(getSettings().codeExcludeRegex).toBe("^HEYZO-");
	});

	it("keeps proxy settings when other fields are saved", () => {
		// 未传的反代字段不应被覆盖（对照 Emby 的同名用例）
		saveSettings({
			apiUrl: "https://d.example/",
			apiKey: "K",
			lookupEnabled: true,
			codeExcludeRegex: "^HEYZO-",
		});
		saveSettings({ supjavName: "X" });
		expect(getSettings().apiUrl).toBe("https://d.example/");
		expect(getSettings().apiKey).toBe("K");
		expect(getSettings().lookupEnabled).toBe(true);
		expect(getSettings().codeExcludeRegex).toBe("^HEYZO-");
	});

	it("can explicitly disable the lookup switch", () => {
		saveSettings({ lookupEnabled: true });
		saveSettings({ lookupEnabled: false });
		expect(getSettings().lookupEnabled).toBe(false);
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

	it("saves an empty supjav template (means unconfigured)", () => {
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

		// 清空名称 → 保存为空（该平台视为未配置，面板不显示按钮）
		saveSettings({ supjavName: "", javdbName: "" });
		expect(getSettings().supjavName).toBe(DEFAULT_SETTINGS.supjavName);
		expect(getSettings().javdbName).toBe(DEFAULT_SETTINGS.javdbName);
	});

	it("defaults all three platforms to unconfigured (empty name + template)", () => {
		// 三个平台完全同构：无内置品牌名与内置地址，名称与链接规则默认都为空
		expect(DEFAULT_SETTINGS.supjavName).toBe("");
		expect(DEFAULT_SETTINGS.javdbName).toBe("");
		expect(DEFAULT_SETTINGS.customName).toBe("");
		expect(DEFAULT_SETTINGS.supjavTemplate).toBe("");
		expect(DEFAULT_SETTINGS.javbusTemplate).toBe("");
		expect(DEFAULT_SETTINGS.customTemplate).toBe("");

		const settings = getSettings();
		expect(settings.supjavName).toBe("");
		expect(settings.javdbName).toBe("");
		expect(settings.customName).toBe("");
		expect(settings.supjavTemplate).toBe("");
		expect(settings.javbusTemplate).toBe("");
		expect(settings.customTemplate).toBe("");

		// 未配置 = 不生成跳转链接（面板也不显示按钮）
		expect(resolveSearchUrl("", "ABP-123")).toBe("");
		expect(resolveSearchUrl("   ", "ABP-123")).toBe("");
	});

	it("allows clearing the JavDB link template back to empty", () => {
		saveSettings({ javbusTemplate: "https://mysite.example.com/search/{code}" });
		expect(getSettings().javbusTemplate).toBe(
			"https://mysite.example.com/search/{code}",
		);

		saveSettings({ javbusTemplate: "" });
		expect(getSettings().javbusTemplate).toBe("");
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
			translateApiUrl: "https://translate.example.com/",
		});
		expect(getSettings().translateEnabled).toBe(true);
		expect(getSettings().translateApiUrl).toBe("https://translate.example.com/");

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

	it("lookup settings default off with empty URL/key and can be saved", () => {
		// 默认：开关关闭、地址与 Key 为空（关闭时预览走 javtrailers 默认链路）
		expect(DEFAULT_SETTINGS.lookupEnabled).toBe(false);
		expect(DEFAULT_SETTINGS.apiUrl).toBe("");
		expect(DEFAULT_SETTINGS.apiKey).toBe("");
		expect(getSettings().lookupEnabled).toBe(false);
		expect(getSettings().apiUrl).toBe("");
		expect(getSettings().apiKey).toBe("");

		saveSettings({
			lookupEnabled: true,
			apiUrl: "https://api.example.com/",
			apiKey: "test-key",
		});
		expect(getSettings().lookupEnabled).toBe(true);
		expect(getSettings().apiUrl).toBe("https://api.example.com/");
		expect(getSettings().apiKey).toBe("test-key");

		// 清空与关闭 → 回默认（javtrailers 模式）
		saveSettings({
			lookupEnabled: false,
			apiUrl: "",
			apiKey: "",
		});
		expect(getSettings().lookupEnabled).toBe(false);
		expect(getSettings().apiUrl).toBe("");
		expect(getSettings().apiKey).toBe("");
	});

	it("saves and restores Emby settings", () => {
		saveSettings({
			embyUrl: "  http://192.168.0.50:8096  ",
			embyApiKey: "  key-123  ",
			embyEnabled: true,
		});
		const saved = getSettings();
		expect(saved.embyUrl).toBe("http://192.168.0.50:8096");
		expect(saved.embyApiKey).toBe("key-123");
		expect(saved.embyEnabled).toBe(true);
	});

	it("defaults Emby settings to disabled and empty", () => {
		expect(DEFAULT_SETTINGS.embyUrl).toBe("");
		expect(DEFAULT_SETTINGS.embyApiKey).toBe("");
		expect(DEFAULT_SETTINGS.embyEnabled).toBe(false);
		expect(getSettings().embyEnabled).toBe(false);
	});

	it("keeps Emby settings when other fields are saved", () => {
		// 未传的 Emby 字段不应被覆盖
		saveSettings({
			embyUrl: "http://h:8096",
			embyApiKey: "K",
			embyEnabled: true,
		});
		saveSettings({ supjavName: "X" });
		expect(getSettings().embyUrl).toBe("http://h:8096");
		expect(getSettings().embyApiKey).toBe("K");
		expect(getSettings().embyEnabled).toBe(true);
	});

	it("falls back to Emby defaults when stored values have wrong types", () => {
		// 存储里类型错误 → 不崩溃并回退默认
		localStorage.setItem(
			SETTINGS_STORAGE_KEY,
			JSON.stringify({ embyUrl: 123, embyApiKey: null, embyEnabled: "yes" }),
		);
		const saved = getSettings();
		expect(saved.embyUrl).toBe("");
		expect(saved.embyApiKey).toBe("");
		expect(saved.embyEnabled).toBe(false);
	});

	it("can explicitly disable Emby", () => {
		saveSettings({ embyEnabled: true });
		saveSettings({ embyEnabled: false });
		expect(getSettings().embyEnabled).toBe(false);
	});

	it("ignores a non-string Emby URL instead of dropping the whole save", () => {
		// 外部传入 null 时只有该字段回退原值，其余字段照常落盘（不能抛错吞掉整次保存）
		saveSettings({ embyUrl: "http://keep:8096" });
		saveSettings({ supjavName: "Y", embyUrl: null as unknown as string });
		expect(getSettings().supjavName).toBe("Y");
		expect(getSettings().embyUrl).toBe("http://keep:8096");
	});

	describe("fallbackService merging", () => {
		it("keeps a stored bing fallback when a partial save omits the field", () => {
			// 回归：Emby 开关只传 emby* 三项，不能把用户选过的 bing 静默重置为 google
			saveSettings({ fallbackService: "bing" });
			saveSettings({
				embyUrl: "http://h:8096",
				embyApiKey: "K",
				embyEnabled: false,
			});
			expect(getSettings().fallbackService).toBe("bing");
		});

		it("saves bing and google, sanitising unknown values to google", () => {
			saveSettings({ fallbackService: "bing" });
			expect(getSettings().fallbackService).toBe("bing");

			saveSettings({ fallbackService: "google" });
			expect(getSettings().fallbackService).toBe("google");

			saveSettings({ fallbackService: "bogus" as unknown as FallbackService });
			expect(getSettings().fallbackService).toBe("google");
		});

		it("round-trips the Emby fields without touching the fallback service", () => {
			saveSettings({ fallbackService: "bing" });
			saveSettings({
				embyUrl: "http://h:8096",
				embyApiKey: "K",
				embyEnabled: true,
			});
			const saved = getSettings();
			expect(saved.fallbackService).toBe("bing");
			expect(saved.embyUrl).toBe("http://h:8096");
			expect(saved.embyApiKey).toBe("K");
			expect(saved.embyEnabled).toBe(true);
		});
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

	describe("isPlatformConfigured", () => {
		it("requires both the platform name and the link rule", () => {
			expect(
				isPlatformConfigured("Supjav", "https://example.com/search?q={code}"),
			).toBe(true);
			// 缺任一项 = 未配置 → 面板不显示该平台按钮
			expect(isPlatformConfigured("", "https://example.com/search?q={code}")).toBe(false);
			expect(isPlatformConfigured("Supjav", "")).toBe(false);
			expect(isPlatformConfigured("", "")).toBe(false);
			// 纯空白同样视为未配置
			expect(isPlatformConfigured("  ", "  ")).toBe(false);
		});
	});

	describe("configSignature", () => {
		it("covers every configurable field", () => {
			const base = { ...DEFAULT_SETTINGS };
			const baseSignature = configSignature(base);
			const patches: Partial<ExtensionSettings>[] = [
				{ supjavName: "S" },
				{ supjavTemplate: "https://example.com/search?q={code}" },
				{ javdbName: "J" },
				{ javbusTemplate: "https://example.com/{code}" },
				{ customName: "C" },
				{ customTemplate: "https://example.com/{code}" },
				{ previewVolume: 50 },
				{ deeplApiKey: "key" },
				{ translateApiUrl: "https://translate.example/" },
				{ translateEnabled: true },
				{ fallbackService: "bing" },
				{ apiUrl: "https://proxy.example/" },
				{ apiKey: "key" },
				{ lookupEnabled: true },
				{ embyUrl: "http://127.0.0.1:8096" },
				{ embyApiKey: "key" },
				{ embyEnabled: true },
				{ embyDropFavoritesInLibrary: true },
				{ webdavUrl: "https://dav.example/" },
				{ webdavUser: "user" },
				{ webdavPass: "pass" },
				{ webdavEnabled: true },
				{ excludedHosts: ["example.com"] },
				{ falenoPrefixes: [] },
				{ customRegex: "\\bFC2-\\d+\\b" },
			{ codeExcludeRegex: "^HEYZO-" },
			{ theme: "dark" },
		];
			for (const patch of patches) {
				expect(configSignature({ ...base, ...patch })).not.toBe(
					baseSignature,
				);
			}
			// 穷尽性守卫：接口新增字段却漏进 patches（= 漏进签名）时，这里必须失败
			expect(patches.map((patch) => Object.keys(patch)[0]).sort()).toEqual(
				Object.keys(DEFAULT_SETTINGS).sort(),
			);
			// 上一条的守卫：patch 值不得等于该字段默认值，否则它只是自比自
			for (const patch of patches) {
				const key = Object.keys(patch)[0] as keyof ExtensionSettings;
				expect(patch[key]).not.toEqual(DEFAULT_SETTINGS[key]);
			}
		});

		it("matches how settings are persisted (trim + regex fallback)", () => {
			const base: ExtensionSettings = {
				...DEFAULT_SETTINGS,
				supjavName: "Supjav",
				supjavTemplate: "https://example.com/search?q={code}",
			};
			// 首尾空白落盘时被 trim：签名必须一致，否则保存后提醒不会消失
			expect(configSignature({ ...base, supjavName: "  Supjav  " })).toBe(
				configSignature(base),
			);
			// 正则留空 = 保存时回退默认正则
			expect(configSignature({ ...base, customRegex: "" })).toBe(
				configSignature({ ...base, customRegex: DEFAULT_CODE_REGEX }),
			);
			// 密码保存时不做 trim：空格属于有效差异
			expect(configSignature({ ...base, webdavPass: " pass " })).not.toBe(
				configSignature({ ...base, webdavPass: "pass" }),
			);
		});
	});

	describe("resolveSearchUrl", () => {
		it("returns an empty string for an unconfigured platform", () => {
			expect(resolveSearchUrl("", "DLDSS-547")).toBe("");
			expect(resolveSearchUrl("  ", "DLDSS-547")).toBe("");
		});

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

	// 面板三个外部跳转按钮共同遵守的契约：显示码先经 toExternalSearchCode 再进模板
	describe("external jump URL composition", () => {
		it("JavDB jump uses the FC2-PPV form for FC2 codes", () => {
			expect(
				resolveSearchUrl(
					"https://javdb.com/search?q={code}",
					toExternalSearchCode("FC2-123456"),
				),
			).toBe("https://javdb.com/search?q=FC2-PPV-123456");
		});

		it("Supjav jump uses the FC2-PPV form for FC2 codes", () => {
			expect(
				resolveSearchUrl(
					"https://supjav.com/zh/?s={code}",
					toExternalSearchCode("FC2-123456"),
				),
			).toBe("https://supjav.com/zh/?s=FC2-PPV-123456");
		});

		it("custom template jump uses the FC2-PPV form for FC2 codes", () => {
			expect(
				resolveSearchUrl(
					"https://mysite.example.com/search/",
					toExternalSearchCode("FC2-123456"),
				),
			).toBe("https://mysite.example.com/search/FC2-PPV-123456");
		});

		it("non-FC2 codes pass through unchanged", () => {
			expect(
				resolveSearchUrl(
					"https://javdb.com/search?q={code}",
					toExternalSearchCode("ABP-123"),
				),
			).toBe("https://javdb.com/search?q=ABP-123");
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

	it("defaults FALENO prefixes to FNS", () => {
		expect(DEFAULT_SETTINGS.falenoPrefixes).toEqual(["FNS"]);
		expect(getSettings().falenoPrefixes).toEqual(["FNS"]);
	});

	it("normalizes and dedupes FALENO prefixes on save", () => {
		saveSettings({ falenoPrefixes: ["fns ", "FNS", "fsdss-", ""] });
		expect(getSettings().falenoPrefixes).toEqual(["FNS", "FSDSS"]);
	});

	it("keeps FALENO prefixes empty when explicitly cleared (disables fallback)", () => {
		saveSettings({ falenoPrefixes: [] });
		expect(getSettings().falenoPrefixes).toEqual([]);
	});

	it("falls back to the default FALENO prefixes when stored value is not an array", () => {
		// 旧存储无该字段 → 补默认 ["FNS"]
		storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({});
		expect(getSettings().falenoPrefixes).toEqual(["FNS"]);

		// 字段被外部改成非数组 → 同样回退默认，不能崩溃
		storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({
			falenoPrefixes: "FNS",
		});
		expect(getSettings().falenoPrefixes).toEqual(["FNS"]);

		// 数组内非字符串元素被丢弃，合法前缀照常归一化
		storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({
			falenoPrefixes: [123, null, "fns "],
		});
		expect(getSettings().falenoPrefixes).toEqual(["FNS"]);
	});
});

describe("theme option", () => {
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

	it("DEFAULT_SETTINGS 默认 theme 为 system", () => {
		expect(DEFAULT_SETTINGS.theme).toBe("system");
	});

	it("normalizeSettings 缺 theme 回落 system", () => {
		expect(normalizeSettings({}).theme).toBe("system");
	});

	it("normalizeSettings 透传合法 light / dark", () => {
		expect(normalizeSettings({ theme: "light" }).theme).toBe("light");
		expect(normalizeSettings({ theme: "dark" }).theme).toBe("dark");
	});

	it("normalizeSettings 非法 theme 回落 system", () => {
		expect(normalizeSettings({ theme: "neon" }).theme).toBe("system");
		expect(normalizeSettings({ theme: 123 }).theme).toBe("system");
	});

	it("saveSettings 透传 theme 并落盘", () => {
		saveSettings({ theme: "light" });
		expect(getSettings().theme).toBe("light");
	});

	it("saveSettings 非法 theme 保留原值（默认 system）", () => {
		saveSettings({ theme: "neon" as never });
		expect(getSettings().theme).toBe("system");
	});
});

describe("embyDropFavoritesInLibrary（删除收藏）", () => {
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

	it("默认关闭", () => {
		expect(DEFAULT_SETTINGS.embyDropFavoritesInLibrary).toBe(false);
		expect(getSettings().embyDropFavoritesInLibrary).toBe(false);
	});

	it("旧配置缺该字段时读回 false", () => {
		// 升级用户的存储里没有这个键：默认关闭是唯一安全的取值（打开等于删数据）
		storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({
			embyUrl: "http://127.0.0.1:8096",
			embyApiKey: "key",
			embyEnabled: true,
		});
		expect(getSettings().embyDropFavoritesInLibrary).toBe(false);
		expect(normalizeSettings({}).embyDropFavoritesInLibrary).toBe(false);
	});

	it("脏值（\"yes\" / 1 / null / 对象 / 数组）回落 false，且不影响整份配置读取", () => {
		for (const dirty of ["yes", 1, 0, null, {}, []] as unknown[]) {
			storageMock[SETTINGS_STORAGE_KEY] = JSON.stringify({
				embyDropFavoritesInLibrary: dirty,
				supjavName: "Z",
			});
			const settings = getSettings();
			expect(settings.embyDropFavoritesInLibrary).toBe(false);
			expect(settings.supjavName).toBe("Z");
		}
	});

	it("saveSettings 写入该字段且不误伤其它字段", () => {
		saveSettings({ fallbackService: "bing", embyUrl: "http://emby.local:8096" });
		saveSettings({ embyDropFavoritesInLibrary: true });

		const saved = getSettings();
		expect(saved.embyDropFavoritesInLibrary).toBe(true);
		expect(saved.fallbackService).toBe("bing");
		expect(saved.embyUrl).toBe("http://emby.local:8096");

		// false 是显式值：不能被当成「未传」而保留旧值（否则开关关不掉）
		saveSettings({ embyDropFavoritesInLibrary: false });
		const closed = getSettings();
		expect(closed.embyDropFavoritesInLibrary).toBe(false);
		expect(closed.fallbackService).toBe("bing");
	});

	it("saveSettings 收到非布尔值时保留原值", () => {
		saveSettings({ embyDropFavoritesInLibrary: true });
		saveSettings({ embyDropFavoritesInLibrary: "yes" as unknown as boolean });
		expect(getSettings().embyDropFavoritesInLibrary).toBe(true);
	});

	it("configSignature 对该字段敏感（否则改开关不会自动保存）", () => {
		const base: ExtensionSettings = { ...DEFAULT_SETTINGS };
		expect(
			configSignature({ ...base, embyDropFavoritesInLibrary: true }),
		).not.toBe(configSignature(base));
		expect(
			configSignature({ ...base, embyDropFavoritesInLibrary: false }),
		).toBe(configSignature(base));
	});

	// ---- 以下为 QA 补充：合并语义与重置语义 ----

	it("保存无关字段后，已打开的开关仍为 true（不被默认值冲掉）", () => {
		saveSettings({ embyDropFavoritesInLibrary: true });
		saveSettings({ previewVolume: 40 });
		expect(getSettings().embyDropFavoritesInLibrary).toBe(true);
	});

	it("resetSettings 把开关恢复为关闭（默认值必须含该字段）", () => {
		saveSettings({ embyDropFavoritesInLibrary: true });
		resetSettings();
		expect(getSettings().embyDropFavoritesInLibrary).toBe(false);
	});

	it("normalizeSettings 对显式 true 原样保留", () => {
		expect(
			normalizeSettings({ embyDropFavoritesInLibrary: true })
				.embyDropFavoritesInLibrary,
		).toBe(true);
	});
});
