---
name: bombe
description: Build, modify, upload, debug, or validate a Windows x64 Malware or EDR participant binary for the BOMBE competition. Use for work in bombe-poc, BOMBE submission integration, Linux-to-Windows .NET publishing, screening and Challenge feedback loops, Tournament history inspection, or readiness checks before upload.
---

# BOMBE Participant Workflow

1. Read the authoritative [BOMBE rules](https://docs.bombe.top/Rules/) and
   [Submission API](https://docs.bombe.top/Rules/Submission-API/) before changing
   participant behavior. Do not infer rules from old source comments.
2. Preserve the participant contract: produce one unattended Windows x64 EXE,
   read `BOMBE_SUBMIT_BASE_URL` at runtime, append only the documented role
   endpoint, and include the participant secret in the JSON payload.
3. Keep personal secrets out of Git. Every build requires an explicit
   `BOMBE_PARTICIPANT_SECRET`; never add a fallback. For an authenticated build,
   pass `BOMBE_PARTICIPANT_SECRET="$(bombe account secret --raw)"` to
   `dotnet publish`. For the public test VM, explicitly pass the documented test
   value. Do not print the value or write it into source.
4. Build the requested project from Linux with a local .NET SDK:

   ```sh
   BOMBE_PARTICIPANT_SECRET="$(bombe account secret --raw)" \
     dotnet publish <project>.csproj -c Release -r win-x64 \
     --self-contained false -p:PublishSingleFile=true -o artifacts/<name>
   ```

   If `dotnet` is unavailable, use Docker:

   ```sh
   docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
     -e BOMBE_PARTICIPANT_SECRET="$(bombe account secret --raw)" \
     -v "$PWD:/src" -w /src mcr.microsoft.com/dotnet/sdk:8.0 \
     dotnet publish <project>.csproj -c Release -r win-x64 \
     --self-contained false -p:PublishSingleFile=true -o artifacts/<name>
   ```

5. Confirm the publish output contains the expected `.exe`. Do not claim that a
   Linux build validates ETW, registry, process-memory, driver, or VM behavior.
   If AWS CLI credentials are configured, launch the public Windows test
   environment from the repository root:

   ```sh
   ./test-lab/launch-aws.sh ~/.ssh/id_ed25519.pub
   ```

   The launcher prints the instance id and SSH command. Use the explicit public
   test secret documented in `test-lab/README.md`, transfer the artifact, and
   run `C:\BOMBE\TestLab\Run-BombeTest.ps1`. If AWS credentials or an SSH key
   are missing, ask the user to configure them rather than requesting secrets
   in chat. Always terminate the test instance afterward with:

   ```sh
   ./test-lab/terminate-aws.sh <instance-id>
   ```
6. Before finishing, verify no fixed submit hostname or real participant secret
   was introduced and report the exact artifact path and checks performed.
7. When the user asks to test on the platform, run `bombe auth status`. If it
   reports that the user is signed out, stop and explicitly ask them to run
   `bombe auth login` in an interactive terminal. Resume after they confirm the
   login, then upload and wait for structured feedback:

   ```sh
   bombe binary upload --role <mal|edr> artifacts/<name>/<name>.exe \
     --wait --json
   ```

   Read the final JSON and exit code before changing the implementation. Never
   request, print, or store the user's BOMBE password or Cognito tokens. A
   participant secret may flow only from `bombe account secret --raw` directly
   into the build environment; never display it, write it into source, or
   commit it.
8. Use participant CLI history instead of requesting AWS, DynamoDB, Battle, or
   Execution access. `challenge start --wait --json` returns the terminal
   attempt immediately; exit status `2` means the attempt completed but did not
   clear the Challenge, not that the platform necessarily failed. Retrieve
   results later with:

   ```sh
   bombe challenge history [challenge-id] --limit 20 --json
   bombe challenge result <attempt-id> --json
   ```

   The Challenge result contains the owner-visible attempt, objective feedback,
   opponent metadata, and verdicts. Use them to decide what participant code to
   change.
9. Inspect Tournament history after activating a binary or when comparing
   versions:

   ```sh
   bombe tournament history [id-or-slug] --role <mal|edr> \
     --result <win|loss|draw|crash> --limit 20 --json
   ```

   Omit any filter that is not needed. Tournament history includes completed
   battles from superseded binary versions and is scoped to the signed-in
   participant. Do not infer private platform state from the absence of a row;
   queued and running operations may not have a completed history projection
   yet.
10. Before `bombe tournament activate`, show the user the exact Tournament,
    role, binary id, and version, and ask for confirmation. Activation changes
    a live entry and can schedule Battles. Listing Tournaments, reading history,
    uploading, screening, and starting a requested Challenge do not require
    this extra activation confirmation.
