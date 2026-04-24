import assert from "node:assert/strict";
import { __registrationSheetSyncTestables } from "./registrationSheetSync";

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest("matches Team Map Ban header with trim + case-insensitive normalization", () => {
  const headers = [" Team Name ", "  TEAM MAP BAN  "];
  assert.equal(__registrationSheetSyncTestables.findMapBanIndex(headers), 1);
  assert.equal(
    __registrationSheetSyncTestables.normalizeHeader("  Team Map Ban  "),
    "teammapban"
  );
});

runTest("uses source-specific fallback for main DD sheet", () => {
  assert.equal(
    __registrationSheetSyncTestables.getMapBanFallbackIndex({
      sourceKey: "dd_registration",
      sourceLabel: "Main DD",
      spreadsheetId: "sheet-id",
      enabled: true,
    }),
    6
  );
});

runTest("uses source-specific fallback for 7C sheet", () => {
  assert.equal(
    __registrationSheetSyncTestables.getMapBanFallbackIndex({
      sourceKey: "7th-circle",
      sourceLabel: "7C",
      spreadsheetId: "sheet-id",
      enabled: true,
    }),
    10
  );
});
