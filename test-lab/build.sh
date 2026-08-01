#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAB_DIR="$ROOT_DIR/test-lab"
OUTPUT_DIR="$LAB_DIR/dist"
BUILD_DIR="$OUTPUT_DIR/.build"
SDK_IMAGE="${DOTNET_SDK_IMAGE:-mcr.microsoft.com/dotnet/sdk:8.0}"
TEST_SECRET="00000000000000000000000000000000"

rm -rf "$OUTPUT_DIR"
mkdir -p "$BUILD_DIR" "$OUTPUT_DIR/bin"

publish() {
  local project="$1"
  local destination="$2"
  local self_contained="$3"
  shift 3

  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp \
    -e DOTNET_CLI_HOME=/tmp \
    -e NUGET_PACKAGES=/tmp/.nuget/packages \
    -v "$ROOT_DIR:/src" \
    -v "$BUILD_DIR:/out" \
    -w /src \
    "$SDK_IMAGE" \
    dotnet publish "$project" -c Release -r win-x64 \
      --self-contained "$self_contained" -p:PublishSingleFile=true \
      -o "/out/$destination" "$@"
}

publish "test-lab/server/Bombe.TestLab.Server.csproj" "server" true
publish "test-lab/dummy/Bombe.TestLab.Dummy.csproj" "dummy" true
publish "malv1/malv1.csproj" "sample-malware" false \
  -p:BOMBE_PARTICIPANT_SECRET="$TEST_SECRET"
publish "edrv1/edrv1.csproj" "sample-edr" false \
  -p:BOMBE_PARTICIPANT_SECRET="$TEST_SECRET"

cp "$BUILD_DIR/server/Bombe.TestLab.Server.exe" "$OUTPUT_DIR/bin/BombeLab.exe"
cp "$BUILD_DIR/dummy/Bombe.TestLab.Dummy.exe" "$OUTPUT_DIR/bin/dummy.exe"
cp "$BUILD_DIR/sample-malware/malv1.exe" "$OUTPUT_DIR/bin/sample-malware.exe"
cp "$BUILD_DIR/sample-edr/edrv1.exe" "$OUTPUT_DIR/bin/sample-edr.exe"
cp "$LAB_DIR/Run-BombeTest.ps1" "$OUTPUT_DIR/Run-BombeTest.ps1"
cp "$LAB_DIR/Reset-BombeTest.ps1" "$OUTPUT_DIR/Reset-BombeTest.ps1"
cp "$LAB_DIR/Enable-BombeSsh.ps1" "$OUTPUT_DIR/Enable-BombeSsh.ps1"
cp "$LAB_DIR/README.md" "$OUTPUT_DIR/README.md"

rm -rf "$BUILD_DIR"

(
  cd "$OUTPUT_DIR"
  sha256sum bin/*.exe > SHA256SUMS
)

echo "Built BOMBE Test Lab at $OUTPUT_DIR"
