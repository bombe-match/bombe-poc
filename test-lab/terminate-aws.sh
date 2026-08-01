#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-west-2}"
INSTANCE_ID="${1:-}"

if [[ -z "$INSTANCE_ID" ]]; then
  echo "Usage: $0 <instance-id>" >&2
  exit 1
fi

PURPOSE="$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].Tags[?Key==`Purpose`].Value | [0]' --output text)"
if [[ "$PURPOSE" != "ParticipantPlayground" ]]; then
  echo "Refusing to terminate an instance not tagged Purpose=ParticipantPlayground." >&2
  exit 1
fi

SG_IDS="$(aws ec2 describe-instances --region "$REGION" --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].SecurityGroups[].GroupId' --output text)"

aws ec2 terminate-instances --region "$REGION" --instance-ids "$INSTANCE_ID" >/dev/null
aws ec2 wait instance-terminated --region "$REGION" --instance-ids "$INSTANCE_ID"

for sg_id in $SG_IDS; do
  sg_purpose="$(aws ec2 describe-security-groups --region "$REGION" --group-ids "$sg_id" \
    --query 'SecurityGroups[0].Tags[?Key==`Purpose`].Value | [0]' --output text)"
  if [[ "$sg_purpose" == "ParticipantPlayground" ]]; then
    aws ec2 delete-security-group --region "$REGION" --group-id "$sg_id"
  fi
done

echo "Terminated $INSTANCE_ID and removed its BOMBE playground security group."
