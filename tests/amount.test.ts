import assert from "node:assert/strict";
import test from "node:test";
import { amountToCents, extractAmountCandidates, normalizeAmount } from "../src/utils/amount.js";

test("normalizeAmount keeps 2 decimals", () => {
  assert.equal(normalizeAmount(12.345), 12.35);
});

test("amountToCents converts correctly", () => {
  assert.equal(amountToCents(35.5), 3550);
});

test("extractAmountCandidates returns numeric values", () => {
  const values = extractAmountCandidates("实付款 ￥35.50 原价 50.00");
  assert.ok(values.includes(35.5));
  assert.ok(values.includes(50));
});

