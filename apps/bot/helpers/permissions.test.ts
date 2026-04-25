import assert from "node:assert/strict";
import {
  evaluateTeamPanelAccessDecision,
  evaluateTournamentPanelAccessDecision,
} from "./permissions";

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest("team leader assigned to exact team can submit", () => {
  const result = evaluateTeamPanelAccessDecision({
    isAdminOverride: false,
    hasTeamLeaderRole: true,
    isMemberOfExactTeam: true,
    isLeader: true,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "allowed");
});

runTest("admin/founder override can submit", () => {
  const result = evaluateTeamPanelAccessDecision({
    isAdminOverride: true,
    hasTeamLeaderRole: false,
    isMemberOfExactTeam: false,
    isLeader: false,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "admin_override");
});

runTest("team leader from another team is denied", () => {
  const result = evaluateTeamPanelAccessDecision({
    isAdminOverride: false,
    hasTeamLeaderRole: true,
    isMemberOfExactTeam: false,
    isLeader: false,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "not_member_of_team");
});

runTest("player without team leader role is denied", () => {
  const result = evaluateTeamPanelAccessDecision({
    isAdminOverride: false,
    hasTeamLeaderRole: false,
    isMemberOfExactTeam: true,
    isLeader: false,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "missing_team_leader_role");
});

runTest("user with no team association is denied", () => {
  const result = evaluateTeamPanelAccessDecision({
    isAdminOverride: false,
    hasTeamLeaderRole: true,
    isMemberOfExactTeam: false,
    isLeader: false,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "not_member_of_team");
});

runTest("tournament panel: Founder is allowed", () => {
  const result = evaluateTournamentPanelAccessDecision({
    inGuild: true,
    isFounder: true,
    isGuildOwner: false,
    hasDiscordAdministratorPermission: false,
    hasConfiguredAdminRole: false,
    hasAdminRoleNameFallback: false,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "founder");
});

runTest("tournament panel: configured Admin role is allowed", () => {
  const result = evaluateTournamentPanelAccessDecision({
    inGuild: true,
    isFounder: false,
    isGuildOwner: false,
    hasDiscordAdministratorPermission: false,
    hasConfiguredAdminRole: true,
    hasAdminRoleNameFallback: false,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "configured_admin_role");
});

runTest("tournament panel: Admin role name fallback is allowed when config role ID is missing", () => {
  const result = evaluateTournamentPanelAccessDecision({
    inGuild: true,
    isFounder: false,
    isGuildOwner: false,
    hasDiscordAdministratorPermission: false,
    hasConfiguredAdminRole: false,
    hasAdminRoleNameFallback: true,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "admin_role_name_fallback");
});

runTest("tournament panel: Team Leader without Admin is denied", () => {
  const result = evaluateTournamentPanelAccessDecision({
    inGuild: true,
    isFounder: false,
    isGuildOwner: false,
    hasDiscordAdministratorPermission: false,
    hasConfiguredAdminRole: false,
    hasAdminRoleNameFallback: false,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "missing_founder_or_admin");
});

runTest("tournament panel: regular Player is denied", () => {
  const result = evaluateTournamentPanelAccessDecision({
    inGuild: true,
    isFounder: false,
    isGuildOwner: false,
    hasDiscordAdministratorPermission: false,
    hasConfiguredAdminRole: false,
    hasAdminRoleNameFallback: false,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "missing_founder_or_admin");
});

runTest("tournament:* button route allows Admin", () => {
  const result = evaluateTournamentPanelAccessDecision({
    inGuild: true,
    isFounder: false,
    isGuildOwner: false,
    hasDiscordAdministratorPermission: false,
    hasConfiguredAdminRole: true,
    hasAdminRoleNameFallback: false,
  });
  assert.equal(result.allowed, true);
});

runTest("tournament:* select route allows Admin", () => {
  const result = evaluateTournamentPanelAccessDecision({
    inGuild: true,
    isFounder: false,
    isGuildOwner: false,
    hasDiscordAdministratorPermission: false,
    hasConfiguredAdminRole: true,
    hasAdminRoleNameFallback: false,
  });
  assert.equal(result.allowed, true);
});

runTest("tournament:* modal route allows Admin", () => {
  const result = evaluateTournamentPanelAccessDecision({
    inGuild: true,
    isFounder: false,
    isGuildOwner: false,
    hasDiscordAdministratorPermission: false,
    hasConfiguredAdminRole: true,
    hasAdminRoleNameFallback: false,
  });
  assert.equal(result.allowed, true);
});
