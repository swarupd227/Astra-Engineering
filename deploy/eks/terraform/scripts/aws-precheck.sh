#!/usr/bin/env bash
# Terraform external data source — missing resources => false (Terraform creates them). Exit 0 always.
set -uo pipefail

ecr_exists="false"
iam_role_exists="false"
oidc_provider_exists="false"

query="$(cat 2>/dev/null || true)"
region="$(echo "$query" | jq -r '.region // empty' 2>/dev/null || true)"
ecr_name="$(echo "$query" | jq -r '.ecr_name // empty' 2>/dev/null || true)"
iam_role="$(echo "$query" | jq -r '.iam_role // empty' 2>/dev/null || true)"
cluster_name="$(echo "$query" | jq -r '.cluster_name // empty' 2>/dev/null || true)"

if command -v aws >/dev/null 2>&1 && [[ -n "$region" && -n "$ecr_name" && -n "$iam_role" ]]; then
  if aws ecr describe-repositories --repository-names "$ecr_name" --region "$region" >/dev/null 2>&1; then
    ecr_exists="true"
  fi

  if aws iam get-role --role-name "$iam_role" >/dev/null 2>&1; then
    iam_role_exists="true"
  fi

  if [[ -n "$cluster_name" ]]; then
    issuer="$(aws eks describe-cluster --name "$cluster_name" --region "$region" \
      --query 'cluster.identity.oidc.issuer' --output text 2>/dev/null || true)"
    if [[ -n "$issuer" && "$issuer" != "None" ]]; then
      issuer_host="${issuer#https://}"
      issuer_host="${issuer_host%/}"
      account_id="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
      if [[ -n "$account_id" && "$account_id" != "None" ]]; then
        oidc_arn="arn:aws:iam::${account_id}:oidc-provider/${issuer_host}"
        if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$oidc_arn" >/dev/null 2>&1; then
          oidc_provider_exists="true"
        fi
      fi
    fi
  fi
fi

jq -n \
  --arg ecr_exists "$ecr_exists" \
  --arg iam_role_exists "$iam_role_exists" \
  --arg oidc_provider_exists "$oidc_provider_exists" \
  '{ecr_exists: $ecr_exists, iam_role_exists: $iam_role_exists, oidc_provider_exists: $oidc_provider_exists}'

exit 0
