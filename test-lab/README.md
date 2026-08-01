# BOMBE Test Lab

The public Test Lab checks participant binary behavior against the documented
BOMBE submission contract. It is intentionally not a replica of the production
Battle launcher, screening bots, timing, or decoy set.

## Launch the AWS playground

The public Windows AMI is `ami-0673d4903c39618b3` in `us-west-2`. With AWS CLI
credentials and an existing SSH public key, run from the repository root:

```sh
./test-lab/launch-aws.sh ~/.ssh/id_ed25519.pub
```

The script launches a `t3.medium` with no instance IAM role and permits SSH
only from the caller's current public IP. It prints the instance id and SSH
command. Terminate the instance and its dedicated security group when done:

```sh
./test-lab/terminate-aws.sh <instance-id>
```

AWS usage is billed to the participant's account while the instance and volume
exist.

## Run a test

Run from an elevated PowerShell terminal in the playground VM:

```powershell
C:\BOMBE\TestLab\Run-BombeTest.ps1 -Role MAL -Binary C:\path\player.exe
C:\BOMBE\TestLab\Run-BombeTest.ps1 -Role EDR -Binary C:\path\player.exe
```

The binary must be built with the public test secret:

```text
00000000000000000000000000000000
```

The command prints a JSON report and writes `run\result.json`. Exit code `0`
means every objective for the selected participant role passed. Exit code `2`
means at least one selected-role objective failed or was not received.

The included sample opponent and two dummy programs are public diagnostics.
They do not represent platform Challenge, screening, Tournament, or production
decoy binaries.
