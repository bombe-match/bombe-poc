import assert from "node:assert/strict";
import test from "node:test";
import {
  personalBattleResult,
  resolveTournament,
  type ParticipantView,
  type TournamentRecord,
} from "../src/api.js";

const tournament: TournamentRecord = {
  id: "tournament:def-con-34",
  slug: "def-con-34",
  name: "DEF CON 34",
  status: "PUBLISHED",
};

test("resolves a tournament by slug or id", () => {
  assert.equal(resolveTournament([tournament], "def-con-34").id, tournament.id);
  assert.equal(
    resolveTournament([tournament], "tournament:def-con-34").slug,
    tournament.slug,
  );
});

test("computes a Tournament result from the participant role", () => {
  const participant = {
    id: "view-1",
    battle_id: "battle-1",
    role: "MAL",
    outcome: "MAL",
  } satisfies ParticipantView;

  assert.equal(personalBattleResult(participant), "WIN");
  assert.equal(personalBattleResult({ ...participant, outcome: "EDR" }), "LOSS");
  assert.equal(personalBattleResult({ ...participant, outcome: "DRAW" }), "DRAW");
  assert.equal(personalBattleResult({ ...participant, outcome: "CRASH" }), "CRASH");
});
