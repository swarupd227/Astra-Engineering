# Terraform external data source — reads JSON query from stdin, writes JSON to stdout.
# Missing ECR / IAM / OIDC provider => "false" (Terraform will create them). Never fails plan for 404s.
# Requires: AWS CLI + valid credentials (when absent, all flags stay false).
$ErrorActionPreference = 'SilentlyContinue'

try {
  $query = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $region = [string]$query.region
  $ecrName = [string]$query.ecr_name
  $iamRole = [string]$query.iam_role
  $clusterName = [string]$query.cluster_name

  $env:AWS_DEFAULT_REGION = $region
  $ecrExists = 'false'
  $iamExists = 'false'
  $oidcExists = 'false'

  if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    [PSCustomObject]@{
      ecr_exists          = $ecrExists
      iam_role_exists     = $iamExists
      oidc_provider_exists = $oidcExists
    } | ConvertTo-Json -Compress
    exit 0
  }

  aws ecr describe-repositories --repository-names $ecrName --region $region 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ecrExists = 'true' }

  aws iam get-role --role-name $iamRole 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $iamExists = 'true' }

  if ($clusterName) {
    $clusterJson = aws eks describe-cluster --name $clusterName --region $region --output json 2>$null
    if ($LASTEXITCODE -eq 0 -and $clusterJson) {
      $issuer = ([string](($clusterJson | ConvertFrom-Json).cluster.identity.oidc.issuer)).TrimEnd('/')
      if ($issuer) {
        $issuerHost = $issuer -replace '^https://', ''
        $accountId = (aws sts get-caller-identity --query Account --output text 2>$null)
        if ($LASTEXITCODE -eq 0 -and $accountId) {
          $oidcArn = "arn:aws:iam::${accountId}:oidc-provider/${issuerHost}"
          aws iam get-open-id-connect-provider --open-id-connect-provider-arn $oidcArn 2>$null | Out-Null
          if ($LASTEXITCODE -eq 0) { $oidcExists = 'true' }
        }
      }
    }
  }

  [PSCustomObject]@{
    ecr_exists             = $ecrExists
    iam_role_exists        = $iamExists
    oidc_provider_exists   = $oidcExists
  } | ConvertTo-Json -Compress
}
catch {
  [PSCustomObject]@{
    ecr_exists             = 'false'
    iam_role_exists        = 'false'
    oidc_provider_exists   = 'false'
  } | ConvertTo-Json -Compress
}

exit 0
