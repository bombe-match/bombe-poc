# BOMBE Participant Agent Guide

Use this repository to build and test a BOMBE Malware or EDR participant
binary. Read `.agents/skills/bombe/SKILL.md` and follow it as the
primary workflow. Also read the current public rules linked from that skill;
do not rely on stale source comments.

## Human Interaction

Ask the participant instead of guessing when any of these are unknown:

- whether they are building Malware or EDR;
- what behavior they want to implement or debug;
- whether they want to upload to the platform;
- whether they want to activate a Ready binary in a live Tournament.

If `bombe auth status` reports that the participant is not signed in, stop and
ask them to run `bombe auth login` in an interactive terminal. Do not ask them
to paste their password, participant secret, or cached Cognito tokens into the
chat. After login, obtain the participant secret only by piping `bombe account
secret --raw` directly into the build environment.

Tournament activation changes the participant's live entry and may schedule
new Battles. Show the exact Tournament, role, and binary version, then obtain
explicit confirmation before running `bombe tournament activate`.

## Workflow

1. When `bombe` is unavailable, install and build the participant CLI with:

   ```sh
   cd cli
   npm ci
   npm run build
   npm link
   cd ..
   ```

2. Confirm authentication with `bombe auth status`.
3. Modify one participant project at a time and preserve the documented
   submission contract.
4. Build a Windows x64 executable without writing the participant secret into
   source or Git.
5. Report the artifact path and local checks.
6. When authorized, upload with `bombe binary upload --wait --json` and use the
   structured screening verdicts to iterate.
7. Use `bombe challenge` and `bombe tournament history` for player-visible
   results. Do not request AWS, DynamoDB, private Battle, or Execution access.

Do not claim that a Linux build proves Windows runtime behavior. Ask the
participant to use the published BOMBE test VM when Windows-specific validation
is required.
