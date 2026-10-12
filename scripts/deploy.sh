#!/usr/bin/env bash
# Déploie la todo list sur AWS (Lambda + DynamoDB) avec la CLI AWS.
#
# Premier déploiement :
#   APP_PASSWORD='…' MCP_TOKEN="$(openssl rand -hex 32)" npm run deploy
# Déploiements suivants : `npm run deploy` réutilise le mot de passe et le jeton
# déjà configurés, sauf si tu les redonnes.
#
# Variables : AWS_REGION (défaut eu-west-3), STACK (défaut todo-list),
# DEPLOY_BUCKET (défaut todo-list-deploy-<compte>-<région>, créé si absent).
set -euo pipefail
cd "$(dirname "$0")/.."

REGION="${AWS_REGION:-eu-west-3}"
STACK="${STACK:-todo-list}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${DEPLOY_BUCKET:-todo-list-deploy-$ACCOUNT-$REGION}"

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "Création du bucket de déploiement $BUCKET"
  aws s3 mb "s3://$BUCKET" --region "$REGION"
fi

echo "Préparation du code"
rm -rf build .deploy && mkdir -p build .deploy
cp -r src public package.json package-lock.json build/
(cd build && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)

aws cloudformation package \
  --template-file template.yaml \
  --s3-bucket "$BUCKET" \
  --output-template-file .deploy/packaged.yaml \
  --region "$REGION"

deploy_args=(
  --template-file .deploy/packaged.yaml
  --stack-name "$STACK"
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND
  --region "$REGION"
)
params=()
if [[ -n "${APP_PASSWORD:-}" ]]; then params+=("AppPassword=$APP_PASSWORD"); fi
if [[ -n "${MCP_TOKEN:-}" ]]; then params+=("McpToken=$MCP_TOKEN"); fi
if (( ${#params[@]} )); then deploy_args+=(--parameter-overrides "${params[@]}"); fi

aws cloudformation deploy "${deploy_args[@]}"

URL="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='AppUrl'].OutputValue" --output text)"
echo
echo "Interface web : $URL"
echo "URL MCP       : ${URL}mcp/<MCP_TOKEN>"
