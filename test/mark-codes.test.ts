import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCodeMarksInTab, markCodesInTab } from "../src/lib/mark-codes";

interface MockTextNode {
	nodeValue: string;
	parentElement: any;
	parentNode: any;
	splitText: ReturnType<typeof vi.fn>;
	nodeType: number;
	previousSibling?: any;
}

describe("markCodesInTab", () => {
	beforeEach(() => {
		if (typeof globalThis.NodeFilter === "undefined") {
			(globalThis as any).NodeFilter = {
				FILTER_ACCEPT: 1,
				FILTER_REJECT: 2,
				FILTER_SKIP: 3,
				SHOW_TEXT: 4,
			};
		}
	});

	/**
	 * 手工 mock 页面 DOM：TreeWalker 遍历给定文本节点列表，
	 * splitText 模拟浏览器行为（截断当前节点并返回剩余后半节点），
	 * insertBefore 把 dot 挂到父元素上，清理时 querySelectorAll 返回已创建的 dot。
	 */
	function createMockDom(nodes: Array<{ text: string; isVisible?: boolean }>) {
		const insertedDots: any[] = [];
		const removedDots: any[] = [];
		const removedMarks: any[] = [];
		const createdSpans: any[] = [];
		const createdMarks: any[] = [];
		const textNodes: MockTextNode[] = [];
		const surroundCalls: Array<{ mark: any; range: any }> = [];

		// mark（金底黑字）挂载的父元素：surroundContents 后用于清理测试
		const badgeParent: any = {
			insertBefore: vi.fn(),
			removeChild: (child: any) => {
				removedMarks.push(child);
				createdMarks.splice(createdMarks.indexOf(child), 1);
				return child;
			},
			normalize: vi.fn(),
		};

		// 浏览器中 splitText(offset) 会把当前节点截断为 [0, offset)，
		// 返回 [offset, end) 的新节点，新节点紧跟原节点之后（previousSibling 指向原节点）
		const splitText = vi.fn(function (this: MockTextNode, offset: number) {
			const after: MockTextNode = {
				nodeValue: this.nodeValue.slice(offset),
				parentElement: this.parentElement,
				parentNode: this.parentNode,
				splitText,
				nodeType: 3,
				previousSibling: this,
			};
			this.nodeValue = this.nodeValue.slice(0, offset);
			// 新节点插入到原节点之后（保持页面遍历顺序）
			const idx = textNodes.indexOf(this);
			textNodes.splice(idx + 1, 0, after);
			return after;
		});

		nodes.forEach((item) => {
			const el: any = {
				tagName: "SPAN",
				style: {},
				checkVisibility: () => item.isVisible !== false,
				getClientRects: () => (item.isVisible !== false ? [{}] : []),
				insertBefore: (child: any, ref: any) => {
					child.parentNode = el;
					// 模拟真实 DOM：dot 与 ref 互为兄弟（dot 在前，番号节点在后）
					child.nextSibling = ref;
					ref.previousSibling = child;
					insertedDots.push({ child, ref });
					return child;
				},
				removeChild: (child: any) => {
					removedDots.push(child);
					createdSpans.splice(createdSpans.indexOf(child), 1);
					// 模拟真实 DOM：移除节点后，其后兄弟的 previousSibling 自动更新
					if (child.nextSibling?.previousSibling === child) {
						child.nextSibling.previousSibling = child.previousSibling;
					}
					return child;
				},
				normalize: vi.fn(),
			};
			textNodes.push({
				nodeValue: item.text,
				parentElement: el,
				parentNode: el,
				splitText,
				nodeType: 3,
			});
		});

		const handlers: Array<{ type: string; fn: (e: any) => void }> = [];
		(globalThis as any).document = {
			body: { tagName: "BODY" },
			head: { appendChild: vi.fn() },
			getElementById: vi.fn(() => null),
			querySelectorAll: (sel: string) => {
				if (sel === ".javcode-dot") return createdSpans;
				if (sel === ".javcode-locate-badge") return createdMarks;
				return [];
			},
			createElement: (tagName: string) => {
				const el: any = {
					tagName: tagName.toUpperCase(),
					className: "",
					style: Object.assign(
						{},
						{
							setProperty: function (prop: string, value: string) {
								(this as any)[prop] = value;
							},
						},
					) as any,
					title: "",
					parentNode: null,
					innerHTML: "",
					appendChild: vi.fn(),
					addEventListener: (type: string, fn: any) => {
						handlers.push({ type, fn });
					},
					firstChild: null,
				};
				if (tagName.toLowerCase() === "span") {
					createdSpans.push(el);
				}
				if (tagName.toLowerCase() === "mark") {
					createdMarks.push(el);
				}
				return el;
			},
			createRange: () => {
				const range: any = {
					setStart: vi.fn(),
					setEnd: vi.fn(),
					surroundContents: (mark: any) => {
						mark.parentNode = badgeParent;
						surroundCalls.push({ mark, range });
					},
				};
				return range;
			},
			createTreeWalker: (
				_root: any,
				_whatToShow: number,
				filter: { acceptNode: (node: any) => number },
			) => {
				let index = -1;
				return {
					nextNode: () => {
						index++;
						while (index < textNodes.length) {
							const node = textNodes[index];
							if (filter.acceptNode(node) === 1) {
								return node;
							}
							index++;
						}
						return null;
					},
				};
			},
		};

		return { insertedDots, removedDots, removedMarks, handlers, createdSpans, surroundCalls };
	}

	it("在每处已识别番号匹配文本末尾插入金色圆点标记", () => {
		const { insertedDots, handlers, createdSpans } = createMockDom([
			{ text: "Check out ABP-123 in this post" },
			{ text: "Also see IPX-456 here" },
		]);

		markCodesInTab(["ABP-123", "IPX-456"], 30);

		// 每个番号一处出现 → 2 个 dot，且每个 dot 都带点击监听
		expect(insertedDots.length).toBe(2);
		expect(handlers.filter((h) => h.type === "click").length).toBe(2);
		// 普通圆点也是 SVG（圆形），与收藏书签统一样式体系
		expect(createdSpans[0]!.innerHTML).toContain("<svg");
		expect(createdSpans[0]!.innerHTML).toContain("circle");
	});

	it("同一番号出现多次时全部标记，直到每番号上限", () => {
		const { insertedDots } = createMockDom([
			{ text: "ABP-123 ABP-123 ABP-123" },
		]);

		markCodesInTab(["ABP-123"], 2);

		expect(insertedDots.length).toBe(2);
	});

	it("点击圆点发送 jt:code-clicked 消息并阻止默认行为", () => {
		(globalThis as any).chrome = {
			runtime: { sendMessage: vi.fn() },
		};
		const { handlers } = createMockDom([
			{ text: "ABP-123 is here" },
		]);

		markCodesInTab(["ABP-123"], 30);

		const preventDefault = vi.fn();
		const stopPropagation = vi.fn();
		handlers.find((h) => h.type === "click")!.fn({
			preventDefault,
			stopPropagation,
		});

		expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
			{ type: "jt:code-clicked", code: "ABP-123" },
		);
		expect(preventDefault).toHaveBeenCalled();
		expect(stopPropagation).toHaveBeenCalled();
	});

	it("点击圆点就地包裹番号为金底黑字标记", () => {
		const { handlers, surroundCalls } = createMockDom([
			{ text: "ABP-123 is here" },
		]);

		markCodesInTab(["ABP-123"], 30);
		handlers.find((h) => h.type === "click")!.fn({
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		});

		// 番号文本被 mark 包裹一次，样式为金底黑字
		expect(surroundCalls.length).toBe(1);
		const mark = surroundCalls[0]!.mark;
		expect(mark.className).toBe("javcode-locate-badge");
		expect(mark.style.cssText).toContain("background:#f59e0b");
		expect(mark.style.cssText).toContain("color:#000000");
		// range 起点 0：番号在 dot 后文本节点的开头
		expect(surroundCalls[0]!.range.setStart).toHaveBeenCalled();
	});

	it("命中的收藏番号用小圆点替换为收藏书签图标", () => {
		const { createdSpans } = createMockDom([
			{ text: "ABP-123 fav" },
			{ text: "IPX-456 not" },
		]);

		markCodesInTab(["ABP-123", "IPX-456"], 30, ["ABP-123"]);

		// 命中收藏的番号用书签图标（含 svg），未收藏的仍是普通圆点
		expect(createdSpans[0]!.className).toContain("javcode-dot--fav");
		expect(createdSpans[0]!.innerHTML).toContain("<svg");
		expect(createdSpans[1]!.className).not.toContain("javcode-dot--fav");
	});

	it("收藏图标的点击行为与小圆点一致：发消息并包裹金底黑字", () => {
		(globalThis as any).chrome = {
			runtime: { sendMessage: vi.fn() },
		};
		const { handlers, surroundCalls } = createMockDom([
			{ text: "ABP-123 fav" },
		]);

		markCodesInTab(["ABP-123"], 30, ["ABP-123"]);
		handlers.find((h) => h.type === "click")!.fn({
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		});

		expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
			{ type: "jt:code-clicked", code: "ABP-123" },
		);
		expect(surroundCalls.length).toBe(1);
	});

	it("点击另一个番号时清理旧金底黑字，页面只保留当前番号一个标记", () => {
		const { handlers, surroundCalls, removedMarks } = createMockDom([
			{ text: "ABP-123 and IPX-456 here" },
		]);

		markCodesInTab(["ABP-123", "IPX-456"], 30);

		// 点击第一个番号圆点 → 产生 ABP-123 的 badge
		handlers.filter((h) => h.type === "click")[0]!.fn({
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		});
		expect(surroundCalls.length).toBe(1);
		expect(removedMarks.length).toBe(0);

		// 点击第二个番号圆点 → 旧 badge 被清理，仅包裹 IPX-456
		handlers.filter((h) => h.type === "click")[1]!.fn({
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		});
		expect(removedMarks.length).toBe(1);
		expect(surroundCalls.length).toBe(2);
	});

	it("hover 发光、移出恢复，圆点与收藏图标统一行为", () => {
		const { handlers, createdSpans } = createMockDom([
			{ text: "ABP-123 is here" },
		]);

		markCodesInTab(["ABP-123"], 30);

		const dotStyle = createdSpans[0]!.style;
		const enter = handlers.find((h) => h.type === "mouseenter")!.fn;
		const leave = handlers.find((h) => h.type === "mouseleave")!.fn;
		enter({});
		expect(dotStyle.filter).toContain("drop-shadow");
		leave({});
		// 移出后恢复无光晕
		expect(dotStyle.filter).toBe("none");
	});

	it("FC2 番号宽松匹配（PPV 变体）", () => {
		const { insertedDots } = createMockDom([
			{ text: "Check FC2 PPV 1234567 now" },
		]);

		markCodesInTab(["FC2-1234567"], 30);

		expect(insertedDots.length).toBe(1);
	});

	it("跳过不可见元素中的番号", () => {
		const { insertedDots } = createMockDom([
			{ text: "Hidden ABP-123", isVisible: false },
			{ text: "Visible ABP-123", isVisible: true },
		]);

		markCodesInTab(["ABP-123"], 30);

		expect(insertedDots.length).toBe(1);
	});

	it("clearCodeMarksInTab 移除旧圆点并合并文本节点", () => {
		const { insertedDots, removedDots } = createMockDom([
			{ text: "ABP-123 old mark" },
		]);
		markCodesInTab(["ABP-123"], 30);
		expect(insertedDots.length).toBe(1);

		clearCodeMarksInTab();

		expect(removedDots.length).toBe(1);
	});

	it("clearCodeMarksInTab 同时清除点击产生的金底黑字标记", () => {
		const { handlers, removedDots, removedMarks } = createMockDom([
			{ text: "ABP-123 old mark" },
		]);
		markCodesInTab(["ABP-123"], 30);
		// 点击圆点产生金底黑字 mark
		handlers.find((h) => h.type === "click")!.fn({
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		});

		clearCodeMarksInTab();

		// 面板关闭清理：圆点与金底黑字标记一并移除
		expect(removedDots.length).toBe(1);
		expect(removedMarks.length).toBe(1);
	});

	it("重复标记幂等：先清理旧圆点，不产生重复", () => {
		const { insertedDots } = createMockDom([
			{ text: "ABP-123 stays" },
		]);

		markCodesInTab(["ABP-123"], 30);
		markCodesInTab(["ABP-123"], 30);

		// 第二次调用前清理了旧 dot，每次各插 1 个，总数 2
		expect(insertedDots.length).toBe(2);
	});
});
