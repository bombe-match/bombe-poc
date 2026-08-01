# BOMBE POC

Starter Malware and EDR implementations for BOMBE. Read the
[competition documentation](https://docs.bombe.top/) before changing the code.

## AI quick start

Launch your coding agent in this repository and give it this prompt:

> Read `AGENTS.md` and use the `bombe` skill. Help me build and test a BOMBE
> binary. Ask me whenever my input is required.

Both projects require `BOMBE_PARTICIPANT_SECRET` at build time. A build without
it fails before compilation. Do not edit or commit a secret in source. The
Battle VM injects `BOMBE_SUBMIT_BASE_URL`; both samples read it at runtime and
append their role endpoint.

For an authenticated platform build, inject the participant secret as an
MSBuild property instead of editing source:

```sh
BOMBE_PARTICIPANT_SECRET="$(bombe account secret --raw)" \
  dotnet publish malv1/malv1.csproj -c Release -r win-x64 \
  --self-contained false -p:PublishSingleFile=true -o artifacts/malv1
```

## Build on Windows

Set `BOMBE_PARTICIPANT_SECRET` in the environment before launching Visual
Studio, then open `bombe-poc.sln` and select
`Build > Publish Selection > Publish` for the desired project. For the public
test VM, explicitly use its documented `00000000000000000000000000000000`
secret; production builds should use `bombe account secret --raw`.

## Build on Linux

The .NET SDK can publish a Windows x64 executable from Linux. With a local SDK:

```sh
BOMBE_PARTICIPANT_SECRET="$(bombe account secret --raw)" \
dotnet publish malv1/malv1.csproj -c Release -r win-x64 \
  --self-contained false -p:PublishSingleFile=true -o artifacts/malv1

BOMBE_PARTICIPANT_SECRET="$(bombe account secret --raw)" \
dotnet publish edrv1/edrv1.csproj -c Release -r win-x64 \
  --self-contained false -p:PublishSingleFile=true -o artifacts/edrv1
```

Or run the SDK in Docker without installing .NET locally:

```sh
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e BOMBE_PARTICIPANT_SECRET="$(bombe account secret --raw)" \
  -v "$PWD:/src" -w /src mcr.microsoft.com/dotnet/sdk:8.0 \
  dotnet publish malv1/malv1.csproj -c Release -r win-x64 \
  --self-contained false -p:PublishSingleFile=true -o artifacts/malv1

docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e BOMBE_PARTICIPANT_SECRET="$(bombe account secret --raw)" \
  -v "$PWD:/src" -w /src mcr.microsoft.com/dotnet/sdk:8.0 \
  dotnet publish edrv1/edrv1.csproj -c Release -r win-x64 \
  --self-contained false -p:PublishSingleFile=true -o artifacts/edrv1
```

The target VM provides the .NET runtime. Linux can build the executable, but
Windows-specific behavior must still be tested in the published BOMBE test VM.

## Test in the Windows playground

The public playground AMI is `ami-0673d4903c39618b3` in `us-west-2`. If AWS CLI
credentials are configured, launch it with a key-only SSH endpoint restricted
to the caller's current IP:

```sh
./test-lab/launch-aws.sh ~/.ssh/id_ed25519.pub
```

Follow the printed SSH command, transfer the Windows executable, and run the
local Test Lab with the documented test secret. See
[`test-lab/README.md`](test-lab/README.md) for commands and cleanup. The Test
Lab uses public diagnostics and is intentionally not a copy of production
Battle orchestration, bots, or decoys.

## Upload from an AI coding agent

The participant CLI uses the same Cognito login, upload API, screening path,
and rate limits as the website. It never receives AWS credentials or direct
DynamoDB access.

```sh
cd cli
npm install
npm run build
npm link

bombe auth login
bombe binary upload --role mal ../artifacts/malv1/malv1.exe --wait --json
```

When the agent asks, run `bombe auth login` yourself once so the password is
entered in a hidden terminal prompt. The CLI stores renewable Cognito tokens in
`~/.config/bombe/credentials.json` with user-only permissions. Coding agents
can then build, upload, wait for screening, and inspect the JSON result without
handling the account password.

Discover Challenge and Tournament identifiers through the CLI instead of
copying internal ids from the website:

```sh
bombe challenge list --json
bombe challenge history --limit 20
bombe challenge result <attempt-id> --json
bombe tournament list --json
bombe tournament activate <id-or-slug> --role mal --binary <binary-id> --json
bombe tournament history [id-or-slug] --role mal --result win --limit 20
```

`challenge start --wait` prints the terminal attempt and objective verdicts
immediately. `challenge history` and `challenge result` retrieve the same
owner-only records later. `tournament history` exposes the current player's
Tournament battle history, including superseded binary versions, with optional
role and result filters. These commands read `ChallengeAttempt` and
`BattleParticipantView`; they do not expose private Battle execution state.

By default the CLI loads public endpoint metadata from
`https://bombe.malwarevillage.org/.well-known/bombe-client.json`. Use
`--server` for another deployed environment, or
`--config /path/to/amplify_outputs.json` for local development.
