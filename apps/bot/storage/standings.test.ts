import assert from "node:assert/strict";
import { buildStandingsFrpTotals } from "./standings";

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest("awards +1 FRP to the Cashout 1st-place team only", () => {
  const totals = buildStandingsFrpTotals(
    [
      { id: 1, teamName: "Alpha" },
      { id: 2, teamName: "Bravo" },
      { id: 3, teamName: "Charlie" },
      { id: 4, teamName: "Delta" },
    ],
    [],
    [{ teamId: 1, teamName: "Alpha", frpAwarded: 1 }]
  );

  assert.equal(totals.get(1)?.frp, 1);
  assert.equal(totals.get(2)?.frp, 0);
  assert.equal(totals.get(3)?.frp, 0);
  assert.equal(totals.get(4)?.frp, 0);
});

runTest("combines Cashout bonus FRP with Final Round FRP", () => {
  const totals = buildStandingsFrpTotals(
    [
      { id: 1, teamName: "Alpha" },
      { id: 2, teamName: "Bravo" },
      { id: 3, teamName: "Charlie" },
      { id: 4, teamName: "Delta" },
    ],
    [
      {
        teamId: 1,
        opponentTeamId: 2,
        frpAwardedToTeam: 2,
        frpAwardedToOpponent: 1,
      },
      {
        teamId: 3,
        opponentTeamId: 4,
        frpAwardedToTeam: 0,
        frpAwardedToOpponent: 2,
      },
    ],
    [{ teamId: 1, teamName: "Alpha", frpAwarded: 1 }]
  );

  assert.equal(totals.get(1)?.frp, 3);
  assert.equal(totals.get(2)?.frp, 1);
  assert.equal(totals.get(3)?.frp, 0);
  assert.equal(totals.get(4)?.frp, 2);
});

runTest("reprocessing the same cycle input stays deterministic", () => {
  const teams = [
    { id: 1, teamName: "Alpha" },
    { id: 2, teamName: "Bravo" },
    { id: 3, teamName: "Charlie" },
    { id: 4, teamName: "Delta" },
  ];
  const officialResults = [
    {
      teamId: 1,
      opponentTeamId: 2,
      frpAwardedToTeam: 2,
      frpAwardedToOpponent: 0,
    },
  ];
  const cashoutBonuses = [{ teamId: 1, teamName: "Alpha", frpAwarded: 1 }];

  const firstPass = buildStandingsFrpTotals(teams, officialResults, cashoutBonuses);
  const secondPass = buildStandingsFrpTotals(teams, officialResults, cashoutBonuses);

  assert.deepEqual(
    Array.from(firstPass.entries()),
    Array.from(secondPass.entries())
  );
  assert.equal(firstPass.get(1)?.frp, 3);
});
