import assert from "node:assert/strict";
import test from "node:test";
import { popoverLayout } from "../layout.shared.ts";

test("popup sits immediately above its badge using its rendered height", () => {
  const menu = popoverLayout({ x: 250, y: 680, width: 110, height: 18 }, { width: 1280, height: 800 }, 194);
  assert.equal(menu.top + 194, 672);
  assert.equal(menu.width, 288);
  assert.equal(menu.left, 250);
});

test("popup stays inside narrow and short viewports", () => {
  for (const screen of [{ width: 280, height: 600 }, { width: 320, height: 480 }, { width: 390, height: 240 }]) {
    const menu = popoverLayout({ x: screen.width - 80, y: screen.height - 70, width: 64, height: 18 }, screen, 360);
    assert.ok(menu.left >= 8);
    assert.ok(menu.left + menu.width <= screen.width - 8);
    assert.ok(menu.top >= 8);
    assert.ok(menu.top + Math.min(360, menu.maxHeight) <= screen.height - 8);
  }
});

test("popup opens below a badge when there is more room below", () => {
  const menu = popoverLayout({ x: 20, y: 24, width: 110, height: 20 }, { width: 390, height: 800 }, 194);
  assert.equal(menu.top, 52);
  assert.ok(menu.maxHeight >= 194);
});

test("popup remains attached when bypass feedback changes its height", () => {
  const anchor = { x: 20, y: 600, width: 110, height: 18 };
  const screen = { width: 390, height: 800 };
  for (const height of [194, 230, 320]) {
    assert.equal(popoverLayout(anchor, screen, height).top + height, anchor.y - 8);
  }
});
