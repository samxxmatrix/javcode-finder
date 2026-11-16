/**
 * refresh 写回保护的判定口径。
 *
 * 背景：`refresh=1` 只跳过"读"，写回是无条件的（见 handlers/dmm.js / handlers/d2pass.js）。
 * 若某次重抓恰好源站缺封面/预告片，就会把原本**永久**的完整条目降级成 6h 的残缺条目，
 * 6 小时内所有调用方都看到缺图。用户点「重新加载」的意图是"更好或不变"，
 * 所以这种情况下必须保留旧条目 —— 判定逻辑集中在 shouldKeepPrevious。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { isEntryIncomplete, shouldKeepPrevious } from '../server/lib/dmm/cache-entry.js';

/** 资料齐全的条目（title / cover_url / preview_url 三者都有） */
const full = (over = {}) => ({
	title: 'title',
	cover_url: 'https://example.test/c.jpg',
	preview_url: 'https://example.test/p.mp4',
	...over,
});

test('新条目缺封面、旧条目完整：保留旧条目', () => {
	assert.equal(shouldKeepPrevious(full(), full({ cover_url: null })), true);
});

test('新条目缺标题或预告片同样触发保护', () => {
	assert.equal(shouldKeepPrevious(full(), full({ title: '' })), true);
	assert.equal(shouldKeepPrevious(full(), full({ preview_url: null })), true);
});

test('新条目完整时照常覆盖（标题改字、换封面都要能落盘）', () => {
	assert.equal(shouldKeepPrevious(full(), full({ title: 'new title' })), false);
});

test('旧条目本身也不全时不做保护：让残缺数据能被新的替换', () => {
	assert.equal(shouldKeepPrevious({ title: null }, full({ cover_url: null })), false);
	// 旧条目缺字段、新条目也缺另一个字段 —— 都属于"不全"，照常写新的
	assert.equal(shouldKeepPrevious({ title: 'a' }, { cover_url: 'b' }), false);
});

test('没有旧条目（首次查询 / 版本不符 / 档位不符）时不保护', () => {
	assert.equal(shouldKeepPrevious(null, full({ title: null })), false);
	assert.equal(shouldKeepPrevious(undefined, {}), false);
});

test('新条目为空对象视为资料不全，旧条目完整时保留旧条目', () => {
	assert.equal(isEntryIncomplete({}), true);
	assert.equal(shouldKeepPrevious(full(), {}), true);
});
