#!/usr/bin/env node

import { input, password } from "@inquirer/prompts";
import { Command, Option } from "commander";
import {
  activateTournamentBinary,
  getChallengeResult,
  getParticipantSecret,
  listBinaries,
  listChallengeHistory,
  listChallenges,
  listTournamentHistory,
  listTournaments,
  personalBattleResult,
  type PersonalBattleResult,
  resolveTournament,
  screeningResult,
  startChallenge,
  uploadBinary,
  waitForChallenge,
  waitForScreening,
} from "./api.js";
import { login, logout, requireAuth } from "./auth.js";
import { loadClientConfig, type ConfigOptions } from "./config.js";
import { credentialsPath } from "./credentials.js";
import { CliError } from "./errors.js";

interface GlobalOptions extends ConfigOptions {
  json?: boolean;
}

const program = new Command();

const globalOptions = (): GlobalOptions => program.opts<GlobalOptions>();

const output = (value: unknown, human?: string): void => {
  if (globalOptions().json || human === undefined) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    process.stdout.write(`${human}\n`);
  }
};

const progress = (message: string): void => {
  if (!globalOptions().json) process.stderr.write(`${message}\n`);
};

const roleValue = (value: string): "MAL" | "EDR" => {
  const role = value.toUpperCase();
  if (role !== "MAL" && role !== "EDR") {
    throw new CliError("Role must be MAL or EDR.");
  }
  return role;
};

const timeoutValue = (value: string): number => {
  const timeout = Number.parseInt(value, 10);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new CliError("Timeout must be a positive number of seconds.");
  }
  return timeout;
};

const limitValue = (value: string): number => {
  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new CliError("Limit must be a positive integer.");
  }
  return limit;
};

const resultValue = (value: string): PersonalBattleResult => {
  const result = value.toUpperCase();
  if (!["WIN", "LOSS", "DRAW", "CRASH"].includes(result)) {
    throw new CliError("Result must be WIN, LOSS, DRAW, or CRASH.");
  }
  return result as PersonalBattleResult;
};

const formatDate = (value?: string): string =>
  value ? new Date(value).toLocaleString() : "";

const withClient = async () => {
  const config = await loadClientConfig(globalOptions());
  const auth = await requireAuth(config);
  return { config, auth };
};

program
  .name("bombe")
  .description("Build-test loop tools for BOMBE participants and coding agents")
  .version("0.1.0")
  .option("--server <url>", "BOMBE website", process.env.BOMBE_SERVER)
  .option("--config <path-or-url>", "client configuration", process.env.BOMBE_CONFIG)
  .option("--json", "emit machine-readable JSON on stdout");

const authCommand = program.command("auth").description("Manage BOMBE login");

authCommand
  .command("login")
  .description("Sign in with a BOMBE email and password")
  .option("--email <email>", "account email")
  .action(async (options: { email?: string }) => {
    if (!process.stdin.isTTY) {
      throw new CliError("Login requires an interactive terminal.");
    }
    const config = await loadClientConfig(globalOptions());
    const email = options.email ?? (await input({ message: "Email:" }));
    const secret = await password({ message: "Password:", mask: "*" });
    const auth = await login(config, email.trim(), secret);
    output(
      { authenticated: true, username: auth.username, user_id: auth.userId },
      `Signed in as ${auth.username}.`,
    );
  });

authCommand
  .command("status")
  .description("Show the current BOMBE login")
  .action(async () => {
    const config = await loadClientConfig(globalOptions());
    const auth = await requireAuth(config);
    output(
      {
        authenticated: true,
        username: auth.username,
        user_id: auth.userId,
        credentials_path: credentialsPath(),
      },
      `Signed in as ${auth.username}.`,
    );
  });

authCommand
  .command("logout")
  .description("Remove locally cached BOMBE tokens")
  .action(async () => {
    const config = await loadClientConfig(globalOptions());
    await logout(config);
    output({ authenticated: false }, "Signed out locally.");
  });

const binaryCommand = program.command("binary").description("Upload and inspect binaries");

const accountCommand = program.command("account").description("Inspect the current account");

accountCommand
  .command("secret")
  .description("Read the current user's participant secret")
  .option("--raw", "write only the secret to stdout")
  .action(async (options: { raw?: boolean }) => {
    const { config, auth } = await withClient();
    const secret = await getParticipantSecret(config, auth);
    if (options.raw) {
      process.stdout.write(`${secret}\n`);
      return;
    }
    if (globalOptions().json) {
      output({ secret });
      return;
    }
    output({}, "Participant secret loaded. Use --raw only when passing it directly to a build.");
  });

binaryCommand
  .command("upload")
  .description("Upload a Windows binary and optionally wait for screening")
  .argument("<file>", "path to a Windows .exe")
  .addOption(new Option("--role <role>", "participant role").makeOptionMandatory())
  .option("--wait", "wait for screening to finish")
  .option("--timeout <seconds>", "screening timeout", timeoutValue, 900)
  .action(
    async (
      file: string,
      options: { role: string; wait?: boolean; timeout: number },
    ) => {
      const { config, auth } = await withClient();
      const role = roleValue(options.role);
      progress(`Uploading ${file} as ${role}...`);
      const binaryId = await uploadBinary(config, auth, role, file);
      if (!options.wait) {
        output({ binary_id: binaryId, upload_status: "ACCEPTED" }, `Upload accepted: ${binaryId}`);
        return;
      }
      const result = await waitForScreening(
        config,
        auth,
        binaryId,
        options.timeout,
        (current) =>
          progress(
            `Screening: ${current.binary?.status ?? "PROCESSING"} / ${current.screening?.status ?? "PENDING"}`,
          ),
      );
      output({ binary_id: binaryId, ...result });
      if (result.screening?.status === "FAILED") process.exitCode = 2;
      if (result.screening?.status === "ERROR") process.exitCode = 3;
    },
  );

binaryCommand
  .command("list")
  .description("List binaries owned by the current user")
  .option("--role <role>", "filter by MAL or EDR")
  .action(async (options: { role?: string }) => {
    const { config, auth } = await withClient();
    const binaries = await listBinaries(
      config,
      auth,
      options.role ? roleValue(options.role) : undefined,
    );
    if (globalOptions().json) {
      output({ binaries });
      return;
    }
    if (!binaries.length) {
      output({}, "No binaries found.");
      return;
    }
    console.table(
      binaries.map((binary) => ({
        id: binary.id,
        role: binary.type,
        version: `v${binary.version}`,
        status: binary.status,
        created: binary.createdAt ?? "",
      })),
    );
  });

binaryCommand
  .command("screening")
  .description("Inspect or wait for a binary screening")
  .argument("<binary-id>", "Binary id returned by upload")
  .option("--wait", "wait for screening to finish")
  .option("--timeout <seconds>", "screening timeout", timeoutValue, 900)
  .action(
    async (binaryId: string, options: { wait?: boolean; timeout: number }) => {
      const { config, auth } = await withClient();
      const result = options.wait
        ? await waitForScreening(config, auth, binaryId, options.timeout, (current) =>
            progress(
              `Screening: ${current.binary?.status ?? "PROCESSING"} / ${current.screening?.status ?? "PENDING"}`,
            ),
          )
        : await screeningResult(config, auth, binaryId);
      output({ binary_id: binaryId, ...result });
      if (result.screening?.status === "FAILED") process.exitCode = 2;
      if (result.screening?.status === "ERROR") process.exitCode = 3;
    },
  );

const challengeCommand = program.command("challenge").description("Run challenge battles");

challengeCommand
  .command("list")
  .description("List available challenges and their ids")
  .option("--role <role>", "filter by MAL or EDR")
  .action(async (options: { role?: string }) => {
    const { config, auth } = await withClient();
    const challenges = await listChallenges(
      config,
      auth,
      options.role ? roleValue(options.role) : undefined,
    );
    if (globalOptions().json) {
      output({ challenges });
      return;
    }
    if (!challenges.length) {
      output({}, "No challenges found.");
      return;
    }
    console.table(
      challenges.map((challenge) => ({
        id: challenge.id,
        role: challenge.role,
        level: challenge.level,
        title: challenge.title,
        enabled: challenge.enabled,
      })),
    );
  });

challengeCommand
  .command("start")
  .description("Start a challenge with one of your ready binaries")
  .argument("<challenge-id>", "Challenge id")
  .addOption(new Option("--binary <binary-id>", "player Binary id").makeOptionMandatory())
  .option("--wait", "wait for the challenge to finish")
  .option("--timeout <seconds>", "battle timeout", timeoutValue, 1200)
  .action(
    async (
      challengeId: string,
      options: { binary: string; wait?: boolean; timeout: number },
    ) => {
      const { config, auth } = await withClient();
      const receipt = await startChallenge(config, auth, challengeId, options.binary);
      if (!options.wait || !receipt.challenge_attempt_id) {
        output(receipt, `Challenge queued: ${receipt.challenge_attempt_id ?? receipt.status}`);
        return;
      }
      const result = await waitForChallenge(
        config,
        auth,
        receipt.challenge_attempt_id,
        options.timeout,
        (attempt) => progress(`Challenge: ${attempt.status}`),
      );
      output({ receipt, ...result });
      if (!result.attempt.completed) process.exitCode = 2;
    },
  );

challengeCommand
  .command("history")
  .description("List your Challenge attempts")
  .argument("[challenge-id]", "optional Challenge id")
  .option("--limit <count>", "maximum attempts to show", limitValue, 20)
  .action(async (challengeId: string | undefined, options: { limit: number }) => {
    const { config, auth } = await withClient();
    const history = (await listChallengeHistory(config, auth, challengeId)).slice(
      0,
      options.limit,
    );
    if (globalOptions().json) {
      output({ attempts: history });
      return;
    }
    if (!history.length) {
      output({}, "No Challenge attempts found.");
      return;
    }
    console.table(
      history.map(({ attempt, participant }) => ({
        completed: formatDate(participant?.completedAt ?? attempt.updatedAt),
        challenge: attempt.challenge_id,
        binary: attempt.player_binary_id,
        status: attempt.status,
        result: attempt.completed ? "CLEARED" : "NOT CLEARED",
        outcome: attempt.outcome ?? "",
        attempt: attempt.id,
      })),
    );
  });

challengeCommand
  .command("result")
  .description("Show one Challenge attempt and its objective verdicts")
  .argument("<attempt-id>", "Challenge attempt id")
  .action(async (attemptId: string) => {
    const { config, auth } = await withClient();
    output(await getChallengeResult(config, auth, attemptId));
  });

const tournamentCommand = program
  .command("tournament")
  .description("Manage tournament participation");

tournamentCommand
  .command("list")
  .description("List published tournaments, ids, and slugs")
  .action(async () => {
    const { config, auth } = await withClient();
    const tournaments = await listTournaments(config, auth);
    if (globalOptions().json) {
      output({ tournaments });
      return;
    }
    if (!tournaments.length) {
      output({}, "No tournaments found.");
      return;
    }
    console.table(
      tournaments.map((tournament) => ({
        id: tournament.id,
        slug: tournament.slug,
        name: tournament.name,
        status: tournament.status,
        begin: tournament.begin
          ? new Date(tournament.begin * 1000).toLocaleString()
          : "",
        end: tournament.end
          ? new Date(tournament.end * 1000).toLocaleString()
          : "",
      })),
    );
  });

tournamentCommand
  .command("activate")
  .description("Set a ready binary active for a tournament role")
  .argument("<tournament>", "Tournament id or slug")
  .addOption(new Option("--role <role>", "MAL or EDR").makeOptionMandatory())
  .addOption(new Option("--binary <binary-id>", "ready Binary id").makeOptionMandatory())
  .action(
    async (
      tournamentIdOrSlug: string,
      options: { role: string; binary: string },
    ) => {
      const { config, auth } = await withClient();
      const tournament = resolveTournament(
        await listTournaments(config, auth),
        tournamentIdOrSlug,
      );
      const result = await activateTournamentBinary(
        config,
        auth,
        tournament.id,
        roleValue(options.role),
        options.binary,
      );
      output(result, result.message ?? `Tournament entry status: ${result.status}`);
    },
  );

tournamentCommand
  .command("history")
  .description("List your Tournament battle history")
  .argument("[tournament]", "optional Tournament id or slug")
  .option("--role <role>", "filter by MAL or EDR")
  .option("--result <result>", "filter by WIN, LOSS, DRAW, or CRASH")
  .option("--limit <count>", "maximum battles to show", limitValue, 20)
  .action(
    async (
      tournamentIdOrSlug: string | undefined,
      options: { role?: string; result?: string; limit: number },
    ) => {
      const { config, auth } = await withClient();
      const tournaments = await listTournaments(config, auth, false);
      const tournament = tournamentIdOrSlug
        ? resolveTournament(tournaments, tournamentIdOrSlug)
        : undefined;
      const history = (
        await listTournamentHistory(
          config,
          auth,
          tournament?.id,
          options.role ? roleValue(options.role) : undefined,
          options.result ? resultValue(options.result) : undefined,
        )
      ).slice(0, options.limit);
      if (globalOptions().json) {
        output({ battles: history });
        return;
      }
      if (!history.length) {
        output({}, "No Tournament battles found.");
        return;
      }
      const tournamentById = new Map(
        tournaments.map((item) => [item.id, item.name]),
      );
      console.table(
        history.map((battle) => ({
          completed: formatDate(battle.completedAt),
          tournament:
            tournamentById.get(battle.tournament_id ?? "") ??
            battle.tournament_id ??
            "",
          role: battle.role ?? "",
          binary: battle.binary_version == null ? "" : `v${battle.binary_version}`,
          opponent: battle.opponent_name ?? battle.opponent_user_id ?? "",
          opponent_binary:
            battle.opponent_binary_version == null
              ? ""
              : `v${battle.opponent_binary_version}`,
          result: personalBattleResult(battle),
          submissions: battle.submission_attempts ?? 0,
          battle: battle.battle_id,
        })),
      );
    },
  );

program.parseAsync().catch((error: unknown) => {
  const cliError = error instanceof CliError ? error : new CliError(
    error instanceof Error ? error.message : "Unexpected CLI error.",
  );
  if (globalOptions().json) {
    process.stderr.write(`${JSON.stringify({ error: cliError.message, exit_code: cliError.exitCode })}\n`);
  } else {
    process.stderr.write(`Error: ${cliError.message}\n`);
  }
  process.exitCode = cliError.exitCode;
});
