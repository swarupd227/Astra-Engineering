#!/usr/bin/env bash
# Install AWS Load Balancer Controller on EKS (creates ALB for Ingress resources).
#
# Prerequisites: aws CLI, kubectl (configured for the cluster), helm 3, eksctl.
# Run from CloudShell after: aws eks update-kubeconfig --name astra-eks --region ap-south-1
#
# Defaults below are hardcoded for astra-eks / ap-south-1. Edit the two lines marked.

set -euo pipefail

# --- Edit here if cluster/region changes ---
AWS_REGION="ap-south-1"
CLUSTER_NAME="astra-eks"
# -------------------------------------------

CONTROLLER_VERSION="${CONTROLLER_VERSION:-v2.8.2}"
HELM_CHART_VERSION="${HELM_CHART_VERSION:-1.8.2}"
POLICY_NAME="${POLICY_NAME:-AWSLoadBalancerControllerIAMPolicy}"
IAM_ROLE_NAME="${IAM_ROLE_NAME:-AmazonEKSLoadBalancerControllerRole-${CLUSTER_NAME}}"
NAMESPACE="${NAMESPACE:-kube-system}"
SA_NAME="${SA_NAME:-aws-load-balancer-controller}"

command -v aws >/dev/null 2>&1 || { echo "aws CLI required"; exit 1; }
command -v kubectl >/dev/null 2>&1 || { echo "kubectl required"; exit 1; }
command -v helm >/dev/null 2>&1 || { echo "helm 3 required"; exit 1; }
command -v eksctl >/dev/null 2>&1 || {
  echo "eksctl required. Install: https://github.com/eksctl-io/eksctl#installation"
  echo '  curl -sL "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_$(uname -s)_amd64.tar.gz" | tar xz -C /tmp && sudo install /tmp/eksctl /usr/local/bin/eksctl'
  exit 1
}

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
VPC_ID="$(aws eks describe-cluster --name "${CLUSTER_NAME}" --region "${AWS_REGION}" --query 'cluster.resourcesVpcConfig.vpcId' --output text)"
echo "Cluster=${CLUSTER_NAME} region=${AWS_REGION} account=${ACCOUNT_ID} vpc=${VPC_ID}"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "${TMPDIR}"' EXIT
POLICY_DOC="${TMPDIR}/iam_policy.json"
curl -fsSL "https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/${CONTROLLER_VERSION}/docs/install/iam_policy.json" -o "${POLICY_DOC}"

# Deterministic ARN — avoids aws list-policies + JMESPath returning literal "None" with -o text.
EXPECTED_POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"
if aws iam get-policy --policy-arn "${EXPECTED_POLICY_ARN}" >/dev/null 2>&1; then
  POLICY_ARN="${EXPECTED_POLICY_ARN}"
  echo "Using existing policy: ${POLICY_ARN}"
else
  echo "Creating IAM policy ${POLICY_NAME}..."
  if POLICY_ARN="$(aws iam create-policy --policy-name "${POLICY_NAME}" --policy-document "file://${POLICY_DOC}" --query Policy.Arn --output text 2>/dev/null)"; then
    :
  else
    if aws iam get-policy --policy-arn "${EXPECTED_POLICY_ARN}" >/dev/null 2>&1; then
      POLICY_ARN="${EXPECTED_POLICY_ARN}"
      echo "Policy exists after duplicate create attempt, using: ${POLICY_ARN}"
    else
      echo "## create-policy failed. Fix IAM iam:CreatePolicy / iam:GetPolicy for this user, then re-run."
      exit 1
    fi
  fi
fi
if [[ ! "${POLICY_ARN}" =~ ^arn:aws:iam::[0-9]{12}:policy/ ]]; then
  echo "## Error: invalid POLICY_ARN: '${POLICY_ARN}'"
  exit 1
fi
echo "Associating IAM OIDC provider (idempotent)..."
eksctl utils associate-iam-oidc-provider --cluster="${CLUSTER_NAME}" --region="${AWS_REGION}" --approve

echo "Creating / updating IRSA ${SA_NAME} in ${NAMESPACE}..."
echo "Tip: if a previous IRSA run failed, open CloudFormation and delete the stack"
echo "     eksctl-${CLUSTER_NAME}-addon-iamserviceaccount-kube-system-aws-load-balancer-controller"
echo "     when it is in ROLLBACK_COMPLETE or CREATE_FAILED, then re-run this script."
eksctl create iamserviceaccount \
  --cluster="${CLUSTER_NAME}" \
  --region="${AWS_REGION}" \
  --namespace="${NAMESPACE}" \
  --name="${SA_NAME}" \
  --role-name="${IAM_ROLE_NAME}" \
  --attach-policy-arn="${POLICY_ARN}" \
  --override-existing-serviceaccounts \
  --approve

echo "Helm: add eks chart repo..."
helm repo add eks https://aws.github.io/eks-charts >/dev/null 2>&1 || true
helm repo update eks

echo "Installing aws-load-balancer-controller Helm chart ${HELM_CHART_VERSION}..."
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
  --version "${HELM_CHART_VERSION}" \
  --namespace "${NAMESPACE}" \
  --set clusterName="${CLUSTER_NAME}" \
  --set serviceAccount.create=false \
  --set serviceAccount.name="${SA_NAME}" \
  --set region="${AWS_REGION}" \
  --set vpcId="${VPC_ID}" \
  --wait --timeout 15m

echo ""
echo "=== Verify ==="
kubectl get deployment -n "${NAMESPACE}" aws-load-balancer-controller
kubectl get pods -n "${NAMESPACE}" -l app.kubernetes.io/name=aws-load-balancer-controller
kubectl get ingressclass

echo ""
echo "If IngressClass is still empty, wait ~1m and re-run: kubectl get ingressclass"
echo "Public ALB subnets: ensure public subnets are tagged kubernetes.io/role/elb = 1 (or elb tag per AWS doc for your cluster version)."
