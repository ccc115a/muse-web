import test from "node:test";
import assert from "node:assert/strict";
import { pendingCount, summaryText } from "../lib.js";

const sample = [
  { id: 1, title: "a", done: true },
  { id: 2, title: "b", done: false },
];

test("pendingCount 只算未完成", () => {
  assert.equal(pendingCount(sample), 1);
  assert.equal(pendingCount([]), 0);
});

test("summaryText 格式正確", () => {
  assert.equal(summaryText(sample), "共 2 項，未完成 1 項");
});
