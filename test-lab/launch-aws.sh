#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-west-2}"
AMI_ID="${BOMBE_PLAYGROUND_AMI_ID:-ami-0673d4903c39618b3}"
INSTANCE_TYPE="${BOMBE_PLAYGROUND_INSTANCE_TYPE:-t3.medium}"
PUBLIC_KEY_PATH="${1:-$HOME/.ssh/id_ed25519.pub}"

for command in aws curl jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

if [[ ! -f "$PUBLIC_KEY_PATH" ]]; then
  echo "SSH public key not found: $PUBLIC_KEY_PATH" >&2
  exit 1
fi

PUBLIC_KEY="$(<"$PUBLIC_KEY_PATH")"
if [[ ! "$PUBLIC_KEY" =~ ^ssh-(ed25519|rsa)[[:space:]] ]]; then
  echo "The public key must be an ssh-ed25519 or ssh-rsa key." >&2
  exit 1
fi

CALLER_IP="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
VPC_ID="$(aws ec2 describe-vpcs --region "$REGION" \
  --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)"

if [[ -z "$VPC_ID" || "$VPC_ID" == "None" ]]; then
  echo "No default VPC exists in $REGION." >&2
  exit 1
fi

SUBNET_ID="$(aws ec2 describe-subnets --region "$REGION" \
  --filters Name=vpc-id,Values="$VPC_ID" Name=map-public-ip-on-launch,Values=true \
  --query 'Subnets | sort_by(@, &AvailabilityZone)[0].SubnetId' --output text)"

if [[ -z "$SUBNET_ID" || "$SUBNET_ID" == "None" ]]; then
  echo "No public subnet exists in the default VPC in $REGION." >&2
  exit 1
fi

SUFFIX="$(date -u +%Y%m%d%H%M%S)-$$"
SG_NAME="bombe-playground-$SUFFIX"
SG_ID="$(aws ec2 create-security-group --region "$REGION" \
  --group-name "$SG_NAME" --description "BOMBE playground SSH access" \
  --vpc-id "$VPC_ID" \
  --tag-specifications 'ResourceType=security-group,Tags=[{Key=Project,Value=BOMBE},{Key=Purpose,Value=ParticipantPlayground}]' \
  --query GroupId --output text)"

INSTANCE_ID=""
cleanup_failed_launch() {
  if [[ -z "$INSTANCE_ID" ]]; then
    aws ec2 delete-security-group --region "$REGION" --group-id "$SG_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup_failed_launch EXIT

IP_PERMISSIONS="$(jq -cn --arg cidr "$CALLER_IP/32" \
  '[{IpProtocol:"tcp",FromPort:22,ToPort:22,IpRanges:[{CidrIp:$cidr,Description:"BOMBE playground SSH"}]}]')"
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
  --ip-permissions "$IP_PERMISSIONS" \
  >/dev/null

ESCAPED_PUBLIC_KEY="${PUBLIC_KEY//\'/\'\'}"
USER_DATA="<powershell>& 'C:\BOMBE\TestLab\Enable-BombeSsh.ps1' -PublicKey '$ESCAPED_PUBLIC_KEY'</powershell>"
NETWORK_INTERFACES="$(jq -cn --arg subnet "$SUBNET_ID" --arg sg "$SG_ID" \
  '[{DeviceIndex:0,AssociatePublicIpAddress:true,DeleteOnTermination:true,SubnetId:$subnet,Groups:[$sg]}]')"

INSTANCE_ID="$(aws ec2 run-instances --region "$REGION" \
  --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" \
  --network-interfaces "$NETWORK_INTERFACES" \
  --metadata-options HttpTokens=required,HttpEndpoint=enabled,InstanceMetadataTags=disabled \
  --user-data "$USER_DATA" \
  --tag-specifications \
    'ResourceType=instance,Tags=[{Key=Name,Value=bombe-participant-playground},{Key=Project,Value=BOMBE},{Key=Purpose,Value=ParticipantPlayground}]' \
    'ResourceType=volume,Tags=[{Key=Name,Value=bombe-participant-playground},{Key=Project,Value=BOMBE},{Key=Purpose,Value=ParticipantPlayground}]' \
  --query 'Instances[0].InstanceId' --output text)"

trap - EXIT
aws ec2 wait instance-status-ok --region "$REGION" --instance-ids "$INSTANCE_ID"

PUBLIC_IP="$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"

cat <<EOF
BOMBE playground is ready.

Instance: $INSTANCE_ID
AMI:      $AMI_ID
SSH:      ssh -i ${PUBLIC_KEY_PATH%.pub} Administrator@$PUBLIC_IP

Terminate it when finished:
  ./test-lab/terminate-aws.sh $INSTANCE_ID
EOF
