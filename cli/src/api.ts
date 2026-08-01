import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import FormData from "form-data";
import type { AuthContext } from "./auth.js";
import type { ClientConfig } from "./config.js";
import { CliError } from "./errors.js";
import { graphql, parseAwsJson } from "./graphql.js";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export interface BinaryRecord {
  id: string;
  type: "MAL" | "EDR";
  version: number;
  sha256: string;
  status: "UPLOADED" | "SCREENING" | "READY" | "REJECTED" | "ARCHIVED";
  createdAt?: string;
  updatedAt?: string;
}

export interface ScreeningRecord {
  id: string;
  binary_id: string;
  battle_id?: string;
  status: "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "ERROR";
  result?: "READY" | "REJECTED";
  outcome?: "MAL" | "EDR" | "DRAW" | "CRASH";
  feedback_events?: unknown;
  startedAt?: string;
  endedAt?: string;
}

export interface ParticipantView {
  id: string;
  battle_id: string;
  user_id?: string;
  role?: "MAL" | "EDR";
  binary_id?: string;
  binary_version?: number;
  opponent_user_id?: string;
  opponent_name?: string;
  opponent_binary_id?: string;
  opponent_binary_version?: number;
  source_type?: "SCREENING" | "CHALLENGE" | "TOURNAMENT";
  source_id?: string;
  tournament_id?: string;
  verdicts?: unknown;
  submission_attempts?: number;
  last_submission_at?: string;
  outcome?: "MAL" | "EDR" | "DRAW" | "CRASH";
  completedAt?: string;
}

export interface ScreeningResult {
  binary?: BinaryRecord;
  screening?: ScreeningRecord;
  participant?: ParticipantView;
}

export const getParticipantSecret = async (
  config: ClientConfig,
  auth: AuthContext,
): Promise<string> => {
  const data = await graphql<{ getUserSecret?: { secret?: string } }>(
    config,
    auth,
    `query GetMyParticipantSecret($id: ID!) {
      getUserSecret(id: $id) { secret }
    }`,
    { id: auth.userId },
  );
  const secret = data.getUserSecret?.secret;
  if (!secret) throw new CliError("Participant secret was not found for this account.");
  return secret;
};

const binaryFields = `
  id type version sha256 status createdAt updatedAt
`;

const screeningFields = `
  id binary_id battle_id status result outcome feedback_events startedAt endedAt
`;

const participantFields = `
  id battle_id user_id role binary_id binary_version
  opponent_user_id opponent_name opponent_binary_id opponent_binary_version
  source_type source_id tournament_id verdicts submission_attempts
  last_submission_at outcome completedAt
`;

const uploadForm = async (
  url: string,
  fields: Record<string, string>,
  file: string,
): Promise<void> => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("file", createReadStream(file), { filename: basename(file) });

  await new Promise<void>((resolve, reject) => {
    form.submit(url, (error, response) => {
      if (error) {
        reject(error);
        return;
      }
      response.resume();
      response.on("end", () => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          resolve();
          return;
        }
        reject(new CliError(`S3 upload failed with HTTP ${response.statusCode ?? "unknown"}.`));
      });
    });
  });
};

export const uploadBinary = async (
  config: ClientConfig,
  auth: AuthContext,
  role: "MAL" | "EDR",
  file: string,
): Promise<string> => {
  const metadata = await stat(file);
  if (!metadata.isFile()) throw new CliError(`Not a file: ${file}`);
  if (metadata.size > MAX_UPLOAD_BYTES) {
    throw new CliError("Binary exceeds the 200 MB upload limit.");
  }
  if (extname(file).toLowerCase() !== ".exe") {
    throw new CliError("BOMBE accepts Windows .exe files only.");
  }

  const response = await fetch(
    `${config.uploadApiUrl}/get-presigned-url?type=${role.toLowerCase()}`,
    { headers: { Accept: "application/json", Authorization: auth.accessToken } },
  );
  const body = (await response.json()) as {
    url?: string;
    fields?: Record<string, string>;
    message?: string;
  };
  if (!response.ok || !body.url || !body.fields) {
    throw new CliError(body.message ?? `Unable to prepare upload (${response.status}).`);
  }
  const key = body.fields.key;
  const uploadId = key?.split("/").at(-1);
  if (!uploadId) throw new CliError("Upload API did not return an upload id.");
  await uploadForm(body.url, body.fields, file);
  return uploadId;
};

export const getBinary = async (
  config: ClientConfig,
  auth: AuthContext,
  id: string,
): Promise<BinaryRecord | undefined> => {
  const data = await graphql<{ getBinary?: BinaryRecord }>(
    config,
    auth,
    `query GetBinary($id: ID!) { getBinary(id: $id) { ${binaryFields} } }`,
    { id },
  );
  return data.getBinary;
};

export const listBinaries = async (
  config: ClientConfig,
  auth: AuthContext,
  role?: "MAL" | "EDR",
): Promise<BinaryRecord[]> => {
  const items: BinaryRecord[] = [];
  let nextToken: string | undefined;
  do {
    const data = await graphql<{
      listBinaryByOwner_id: { items: BinaryRecord[]; nextToken?: string };
    }>(
      config,
      auth,
      `query ListMyBinaries($ownerId: String!, $nextToken: String) {
        listBinaryByOwner_id(owner_id: $ownerId, nextToken: $nextToken) {
          items { ${binaryFields} }
          nextToken
        }
      }`,
      { ownerId: auth.userId, nextToken },
    );
    items.push(...data.listBinaryByOwner_id.items);
    nextToken = data.listBinaryByOwner_id.nextToken;
  } while (nextToken);
  return items
    .filter((item) => !role || item.type === role)
    .sort((left, right) => right.version - left.version);
};

export const getScreening = async (
  config: ClientConfig,
  auth: AuthContext,
  binaryId: string,
): Promise<ScreeningRecord | undefined> => {
  const data = await graphql<{ getBinaryScreening?: ScreeningRecord }>(
    config,
    auth,
    `query GetBinaryScreening($id: ID!) {
      getBinaryScreening(id: $id) { ${screeningFields} }
    }`,
    { id: `screening:${binaryId}` },
  );
  if (data.getBinaryScreening) {
    data.getBinaryScreening.feedback_events = parseAwsJson(
      data.getBinaryScreening.feedback_events,
    );
  }
  return data.getBinaryScreening;
};

export const getParticipantView = async (
  config: ClientConfig,
  auth: AuthContext,
  battleId: string,
): Promise<ParticipantView | undefined> => {
  const data = await graphql<{
    listBattleParticipantViewByBattle_id: { items: ParticipantView[] };
  }>(
    config,
    auth,
    `query GetMyBattleView($battleId: ID!) {
      listBattleParticipantViewByBattle_id(battle_id: $battleId) {
        items { ${participantFields} }
      }
    }`,
    { battleId },
  );
  const view = data.listBattleParticipantViewByBattle_id.items.find(
    (item) => item.battle_id === battleId,
  );
  if (view) view.verdicts = parseAwsJson(view.verdicts);
  return view;
};

export const screeningResult = async (
  config: ClientConfig,
  auth: AuthContext,
  binaryId: string,
): Promise<ScreeningResult> => {
  const [binary, screening] = await Promise.all([
    getBinary(config, auth, binaryId),
    getScreening(config, auth, binaryId),
  ]);
  const participant = screening?.battle_id
    ? await getParticipantView(config, auth, screening.battle_id)
    : undefined;
  return { binary, screening, participant };
};

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const waitForScreening = async (
  config: ClientConfig,
  auth: AuthContext,
  binaryId: string,
  timeoutSeconds: number,
  onProgress?: (result: ScreeningResult) => void,
): Promise<ScreeningResult> => {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let previous = "";
  while (Date.now() < deadline) {
    const result = await screeningResult(config, auth, binaryId);
    const state = `${result.binary?.status ?? "PROCESSING"}/${result.screening?.status ?? "PENDING"}`;
    if (state !== previous) {
      onProgress?.(result);
      previous = state;
    }
    if (
      result.screening &&
      ["PASSED", "FAILED", "ERROR"].includes(result.screening.status)
    ) {
      return result;
    }
    await sleep(5000);
  }
  throw new CliError(`Screening did not finish within ${timeoutSeconds} seconds.`, 3);
};

export interface ChallengeStartResult {
  ok: boolean;
  status: string;
  message?: string;
  challenge_attempt_id?: string;
  battle_id?: string;
  execution_id?: string;
  skipped?: boolean;
}

export interface ChallengeRecord {
  id: string;
  role: "MAL" | "EDR";
  level: number;
  title: string;
  description?: string;
  opponent_binary_id: string;
  enabled?: boolean;
  sort_order?: number;
}

export const listChallenges = async (
  config: ClientConfig,
  auth: AuthContext,
  role?: "MAL" | "EDR",
): Promise<ChallengeRecord[]> => {
  const items: ChallengeRecord[] = [];
  let nextToken: string | undefined;
  do {
    const data = await graphql<{
      listChallenges: { items: ChallengeRecord[]; nextToken?: string };
    }>(
      config,
      auth,
      `query ListChallenges($nextToken: String) {
        listChallenges(nextToken: $nextToken) {
          items { id role level title description opponent_binary_id enabled sort_order }
          nextToken
        }
      }`,
      { nextToken },
    );
    items.push(...data.listChallenges.items);
    nextToken = data.listChallenges.nextToken;
  } while (nextToken);
  return items
    .filter((item) => item.enabled)
    .filter((item) => !role || item.role === role)
    .sort(
      (left, right) =>
        (left.sort_order ?? 0) - (right.sort_order ?? 0) ||
        left.level - right.level,
    );
};

export const startChallenge = async (
  config: ClientConfig,
  auth: AuthContext,
  challengeId: string,
  binaryId: string,
): Promise<ChallengeStartResult> => {
  const data = await graphql<{ startChallenge: ChallengeStartResult }>(
    config,
    auth,
    `mutation StartChallenge($challengeId: ID!, $binaryId: ID!) {
      startChallenge(challenge_id: $challengeId, player_binary_id: $binaryId) {
        ok status message challenge_attempt_id battle_id execution_id skipped
      }
    }`,
    { challengeId, binaryId },
  );
  if (!data.startChallenge.ok) {
    throw new CliError(data.startChallenge.message ?? "Unable to start challenge.");
  }
  return data.startChallenge;
};

export interface ChallengeAttempt {
  id: string;
  challenge_id: string;
  player_binary_id: string;
  battle_id?: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
  outcome?: "MAL" | "EDR" | "DRAW" | "CRASH";
  completed?: boolean;
  feedback_events?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

const challengeAttemptFields = `
  id challenge_id player_binary_id battle_id status outcome completed
  feedback_events createdAt updatedAt
`;

export const getChallengeAttempt = async (
  config: ClientConfig,
  auth: AuthContext,
  attemptId: string,
): Promise<ChallengeAttempt | undefined> => {
  const data = await graphql<{ getChallengeAttempt?: ChallengeAttempt }>(
    config,
    auth,
    `query GetChallengeAttempt($id: ID!) {
      getChallengeAttempt(id: $id) { ${challengeAttemptFields} }
    }`,
    { id: attemptId },
  );
  if (data.getChallengeAttempt) {
    data.getChallengeAttempt.feedback_events = parseAwsJson(
      data.getChallengeAttempt.feedback_events,
    );
  }
  return data.getChallengeAttempt;
};

export const getChallengeResult = async (
  config: ClientConfig,
  auth: AuthContext,
  attemptId: string,
): Promise<{ attempt: ChallengeAttempt; participant?: ParticipantView }> => {
  const attempt = await getChallengeAttempt(config, auth, attemptId);
  if (!attempt) throw new CliError(`Challenge attempt not found: ${attemptId}`);
  return {
    attempt,
    participant: attempt.battle_id
      ? await getParticipantView(config, auth, attempt.battle_id)
      : undefined,
  };
};

export const listChallengeHistory = async (
  config: ClientConfig,
  auth: AuthContext,
  challengeId?: string,
): Promise<Array<{ attempt: ChallengeAttempt; participant?: ParticipantView }>> => {
  const attempts: ChallengeAttempt[] = [];
  let nextToken: string | undefined;
  do {
    const data = await graphql<{
      listChallengeAttemptByUser_id: {
        items: ChallengeAttempt[];
        nextToken?: string;
      };
    }>(
      config,
      auth,
      `query ListMyChallengeAttempts($userId: String!, $nextToken: String) {
        listChallengeAttemptByUser_id(user_id: $userId, nextToken: $nextToken) {
          items { ${challengeAttemptFields} }
          nextToken
        }
      }`,
      { userId: auth.userId, nextToken },
    );
    for (const attempt of data.listChallengeAttemptByUser_id.items) {
      attempt.feedback_events = parseAwsJson(attempt.feedback_events);
      attempts.push(attempt);
    }
    nextToken = data.listChallengeAttemptByUser_id.nextToken;
  } while (nextToken);

  const participants = await listParticipantHistory(config, auth, "CHALLENGE");
  const participantBySource = new Map(
    participants.map((participant) => [participant.source_id, participant]),
  );
  return attempts
    .filter((attempt) => !challengeId || attempt.challenge_id === challengeId)
    .sort(
      (left, right) =>
        Date.parse(right.createdAt ?? right.updatedAt ?? "") -
        Date.parse(left.createdAt ?? left.updatedAt ?? ""),
    )
    .map((attempt) => ({
      attempt,
      participant: participantBySource.get(attempt.id),
    }));
};

export const waitForChallenge = async (
  config: ClientConfig,
  auth: AuthContext,
  attemptId: string,
  timeoutSeconds: number,
  onProgress?: (attempt: ChallengeAttempt) => void,
): Promise<{ attempt: ChallengeAttempt; participant?: ParticipantView }> => {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let previous = "";
  while (Date.now() < deadline) {
    const attempt = await getChallengeAttempt(config, auth, attemptId);
    if (attempt) {
      if (attempt.status !== previous) {
        onProgress?.(attempt);
        previous = attempt.status;
      }
      if (["DONE", "ERROR"].includes(attempt.status)) {
        return {
          attempt,
          participant: attempt.battle_id
            ? await getParticipantView(config, auth, attempt.battle_id)
            : undefined,
        };
      }
    }
    await sleep(5000);
  }
  throw new CliError(`Challenge did not finish within ${timeoutSeconds} seconds.`, 3);
};

export const activateTournamentBinary = async (
  config: ClientConfig,
  auth: AuthContext,
  tournamentId: string,
  role: "MAL" | "EDR",
  binaryId: string,
) => {
  const data = await graphql<{
    setTournamentActiveBinary: {
      ok: boolean;
      status: string;
      message?: string;
      tournament_entry_id?: string;
      active_binary_id?: string;
      desired_active_binary_id?: string;
      debounce_until?: string;
    };
  }>(
    config,
    auth,
    `mutation SetTournamentActiveBinary($tournamentId: ID!, $role: String!, $binaryId: ID!) {
      setTournamentActiveBinary(tournament_id: $tournamentId, role: $role, binary_id: $binaryId) {
        ok status message tournament_entry_id active_binary_id desired_active_binary_id debounce_until
      }
    }`,
    { tournamentId, role, binaryId },
  );
  if (!data.setTournamentActiveBinary.ok) {
    throw new CliError(
      data.setTournamentActiveBinary.message ?? "Unable to activate binary.",
    );
  }
  return data.setTournamentActiveBinary;
};

export interface TournamentRecord {
  id: string;
  slug: string;
  name: string;
  description?: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  begin?: number;
  end?: number;
}

export const listTournaments = async (
  config: ClientConfig,
  auth: AuthContext,
  publishedOnly = true,
): Promise<TournamentRecord[]> => {
  const items: TournamentRecord[] = [];
  let nextToken: string | undefined;
  do {
    const data = await graphql<{
      listTournaments: { items: TournamentRecord[]; nextToken?: string };
    }>(
      config,
      auth,
      `query ListTournaments($nextToken: String) {
        listTournaments(nextToken: $nextToken) {
          items { id slug name description status begin end }
          nextToken
        }
      }`,
      { nextToken },
    );
    items.push(...data.listTournaments.items);
    nextToken = data.listTournaments.nextToken;
  } while (nextToken);
  return items
    .filter((item) => !publishedOnly || item.status === "PUBLISHED")
    .sort((left, right) => (right.begin ?? 0) - (left.begin ?? 0));
};

export const resolveTournament = (
  tournaments: TournamentRecord[],
  idOrSlug: string,
): TournamentRecord => {
  const tournament = tournaments.find(
    (item) => item.id === idOrSlug || item.slug === idOrSlug,
  );
  if (!tournament) throw new CliError(`Tournament not found: ${idOrSlug}`);
  return tournament;
};

export type PersonalBattleResult = "WIN" | "LOSS" | "DRAW" | "CRASH";

export const personalBattleResult = (
  participant: ParticipantView,
): PersonalBattleResult => {
  if (participant.outcome === "CRASH") return "CRASH";
  if (participant.outcome === "DRAW" || !participant.outcome) return "DRAW";
  return participant.outcome === participant.role ? "WIN" : "LOSS";
};

export const listParticipantHistory = async (
  config: ClientConfig,
  auth: AuthContext,
  sourceType?: "SCREENING" | "CHALLENGE" | "TOURNAMENT",
): Promise<ParticipantView[]> => {
  const items: ParticipantView[] = [];
  let nextToken: string | undefined;
  do {
    const data = await graphql<{
      listBattleParticipantViewByUser_id: {
        items: ParticipantView[];
        nextToken?: string;
      };
    }>(
      config,
      auth,
      `query ListMyBattleHistory($userId: String!, $nextToken: String) {
        listBattleParticipantViewByUser_id(
          user_id: $userId
          nextToken: $nextToken
          sortDirection: DESC
        ) {
          items { ${participantFields} }
          nextToken
        }
      }`,
      { userId: auth.userId, nextToken },
    );
    for (const item of data.listBattleParticipantViewByUser_id.items) {
      item.verdicts = parseAwsJson(item.verdicts);
      items.push(item);
    }
    nextToken = data.listBattleParticipantViewByUser_id.nextToken;
  } while (nextToken);
  return items.filter((item) => !sourceType || item.source_type === sourceType);
};

export const listTournamentHistory = async (
  config: ClientConfig,
  auth: AuthContext,
  tournamentId?: string,
  role?: "MAL" | "EDR",
  result?: PersonalBattleResult,
): Promise<ParticipantView[]> =>
  (await listParticipantHistory(config, auth, "TOURNAMENT")).filter(
    (item) =>
      (!tournamentId || item.tournament_id === tournamentId) &&
      (!role || item.role === role) &&
      (!result || personalBattleResult(item) === result),
  );
