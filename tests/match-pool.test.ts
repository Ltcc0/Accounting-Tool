import assert from "node:assert/strict";
import test from "node:test";
import { MatchPool } from "../src/agent/match-pool.js";

test("MatchPool matches screenshot and invoice in same scope", () => {
  const pool = new MatchPool();
  pool.addScreenshot({
    id: "s1",
    amount: 35.5,
    scopeKey: "chat-a",
    imageFileToken: "img_tk_1"
  });

  const result = pool.addInvoice({
    id: "i1",
    amount: 35.5,
    scopeKey: "chat-a",
    pdfFileToken: "pdf_tk_1"
  });

  assert.ok(result.matched);
  assert.equal(result.matched?.amount, 35.5);
});

test("MatchPool does not cross-match different scopes", () => {
  const pool = new MatchPool();
  pool.addScreenshot({
    id: "s2",
    amount: 50,
    scopeKey: "chat-a",
    imageFileToken: "img_tk_2"
  });

  const result = pool.addInvoice({
    id: "i2",
    amount: 50,
    scopeKey: "chat-b",
    pdfFileToken: "pdf_tk_2"
  });

  assert.equal(result.matched, undefined);
});

