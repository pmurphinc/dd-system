import assert from "node:assert/strict";
import { PermissionsBitField } from "discord.js";
import { evaluateTrackedTeamPanelChannelSafety } from "./teamPanelVisibility";

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function makeChannel(options: {
  denyEveryoneView?: boolean;
  allowedRoleIds?: string[];
}) {
  const everyoneId = "everyone-role";
  const overwrites = new Map<string, { allow: PermissionsBitField; deny: PermissionsBitField }>();

  if (options.denyEveryoneView) {
    overwrites.set(everyoneId, {
      allow: new PermissionsBitField(),
      deny: new PermissionsBitField(PermissionsBitField.Flags.ViewChannel),
    });
  }

  for (const roleId of options.allowedRoleIds ?? []) {
    overwrites.set(roleId, {
      allow: new PermissionsBitField(PermissionsBitField.Flags.ViewChannel),
      deny: new PermissionsBitField(),
    });
  }

  return {
    type: 0,
    guild: {
      roles: {
        everyone: {
          id: everyoneId,
        },
      },
    },
    permissionOverwrites: {
      cache: {
        get: (id: string) => overwrites.get(id),
      },
    },
  } as any;
}

runTest("marks shared channel as shared_or_unknown", () => {
  const result = evaluateTrackedTeamPanelChannelSafety(
    makeChannel({ denyEveryoneView: false, allowedRoleIds: [] }),
    { discordRoleId: "team-role-1" } as any
  );
  assert.equal(result.kind, "shared_or_unknown");
});

runTest("marks matching private team channel as safe", () => {
  const result = evaluateTrackedTeamPanelChannelSafety(
    makeChannel({ denyEveryoneView: true, allowedRoleIds: ["team-role-1"] }),
    { discordRoleId: "team-role-1" } as any
  );
  assert.equal(result.kind, "correct_team_private_channel");
});

runTest("marks mismatched private channel as wrong team", () => {
  const result = evaluateTrackedTeamPanelChannelSafety(
    makeChannel({ denyEveryoneView: true, allowedRoleIds: ["team-role-2"] }),
    { discordRoleId: "team-role-1" } as any
  );
  assert.equal(result.kind, "wrong_team_private_channel");
});
