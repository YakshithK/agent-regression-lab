import assert from "node:assert";
import test from "node:test";

import { normalizeOutput } from "../src/normalize.js";

test("strip_whitespace collapses leading trailing and interior whitespace", () => {
  assert.equal(normalizeOutput("  Hello \n\t world   ", ["strip_whitespace"]), "Hello world");
});

test("lowercase lowercases output", () => {
  assert.equal(normalizeOutput("Refunded ORDER Ord_1024", ["lowercase"]), "refunded order ord_1024");
});

test("ignore_dates replaces ISO and natural language dates", () => {
  const output = normalizeOutput("Run on 2026-05-10, May 10 2026, 10 May 2026, and May 2026.", ["ignore_dates"]);
  assert.equal(output, "Run on <DATE>, <DATE>, <DATE>, and <DATE>.");
});

test("rules are applied in order", () => {
  assert.equal(normalizeOutput("  Refunded MAY 10 2026  ", ["strip_whitespace", "lowercase", "ignore_dates"]), "refunded <DATE>");
});

test("empty rules leave output unchanged", () => {
  assert.equal(normalizeOutput("  Mixed Case 2026-05-10  ", []), "  Mixed Case 2026-05-10  ");
});

test("unknown rule throws with supported rules", () => {
  assert.throws(
    () => normalizeOutput("hello", ["unknown_rule"]),
    /Unknown normalize rule: unknown_rule\. Supported: strip_whitespace, lowercase, ignore_dates/,
  );
});
