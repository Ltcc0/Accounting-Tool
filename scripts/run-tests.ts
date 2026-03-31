import assert from "node:assert/strict";
import { MatchPool } from "../src/agent/match-pool.js";
import { amountToCents, extractAmountCandidates, normalizeAmount } from "../src/utils/amount.js";

function runAmountTests(): void {
  assert.equal(normalizeAmount(12.345), 12.35);
  assert.equal(amountToCents(35.5), 3550);
  const values = extractAmountCandidates("实付款 ￥35.50 原价 50.00");
  assert.ok(values.includes(35.5));
  assert.ok(values.includes(50));
}

function runMatchPoolTests(): void {
  const pool = new MatchPool();
  pool.addScreenshot({
    id: "s1",
    amount: 35.5,
    scopeKey: "chat-a",
    imageFileToken: "img_tk_1"
  });
  const matched = pool.addInvoice({
    id: "i1",
    amount: 35.5,
    scopeKey: "chat-a",
    pdfFileToken: "pdf_tk_1"
  });
  assert.ok(matched.matched);
  assert.equal(matched.matched?.amount, 35.5);

  const pool2 = new MatchPool();
  pool2.addScreenshot({
    id: "s2",
    amount: 50,
    scopeKey: "chat-a",
    imageFileToken: "img_tk_2"
  });
  const unmatched = pool2.addInvoice({
    id: "i2",
    amount: 50,
    scopeKey: "chat-b",
    pdfFileToken: "pdf_tk_2"
  });
  assert.equal(unmatched.matched, undefined);
}

function main(): void {
  runAmountTests();
  runMatchPoolTests();
  console.log("All tests passed.");
}

main();

