#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl não encontrado" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node não encontrado" >&2
  exit 1
fi

echo "[1/8] Iniciando API BohPay MVP..."
node src/server.js >/tmp/bohpay-mvp.log 2>&1 &
SERVER_PID=$!
cleanup() {
  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for _ in {1..40}; do
  if curl -s "$BASE_URL/admin/stats" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if ! curl -s "$BASE_URL/admin/stats" >/dev/null 2>&1; then
  echo "API não respondeu em $BASE_URL" >&2
  exit 1
fi

post_ussd() {
  local session_id="$1"
  local phone="$2"
  local text="$3"

  curl -s -X POST "$BASE_URL/ussd" \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\":\"${session_id}\",\"phoneNumber\":\"${phone}\",\"text\":\"${text}\"}"
}

contains_or_fail() {
  local value="$1"
  local expected="$2"
  local label="$3"

  if [[ "$value" != *"$expected"* ]]; then
    echo "Falha em: $label" >&2
    echo "Esperado conter: $expected" >&2
    echo "Recebido: $value" >&2
    exit 1
  fi
}

echo "[2/8] Registando utilizador A (9910001)..."
r=$(post_ussd "sA" "9910001" "")
contains_or_fail "$r" "Criar conta" "menu inicial registo A"
post_ussd "sA" "9910001" "1" >/dev/null
post_ussd "sA" "9910001" "Alice" >/dev/null
post_ussd "sA" "9910001" "1234" >/dev/null
r=$(post_ussd "sA" "9910001" "1234")
contains_or_fail "$r" "Conta criada com sucesso" "confirmação de conta A"

echo "[3/8] Registando utilizador B (9910002)..."
post_ussd "sB" "9910002" "" >/dev/null
post_ussd "sB" "9910002" "1" >/dev/null
post_ussd "sB" "9910002" "Bruno" >/dev/null
post_ussd "sB" "9910002" "1234" >/dev/null
r=$(post_ussd "sB" "9910002" "1234")
contains_or_fail "$r" "Conta criada com sucesso" "confirmação de conta B"

echo "[4/8] Ajustando saldo da conta A via admin..."
r=$(curl -s -X POST "$BASE_URL/admin/adjust-balance" -H "Content-Type: application/json" -d '{"phone":"9910001","amount":2000}')
contains_or_fail "$r" "\"ok\":true" "ajuste de saldo"

echo "[5/8] Consultando saldo com PIN..."
post_ussd "sBal" "9910001" "" >/dev/null
post_ussd "sBal" "9910001" "1" >/dev/null
r=$(post_ussd "sBal" "9910001" "1234")
contains_or_fail "$r" "Saldo atual: 2000.00 CVE" "consulta de saldo"

echo "[6/8] Executando transferência P2P 500 CVE..."
post_ussd "sP2P" "9910001" "" >/dev/null
post_ussd "sP2P" "9910001" "2" >/dev/null
post_ussd "sP2P" "9910001" "9910002" >/dev/null
post_ussd "sP2P" "9910001" "500" >/dev/null
post_ussd "sP2P" "9910001" "1" >/dev/null
r=$(post_ussd "sP2P" "9910001" "1234")
contains_or_fail "$r" "Transferência concluída" "transferência p2p"

echo "[7/8] Validando histórico e logs SMS..."
r=$(curl -s "$BASE_URL/admin/logs")
contains_or_fail "$r" "P2P_SEND" "transação de envio"
contains_or_fail "$r" "P2P_RECEIVE" "transação de receção"
contains_or_fail "$r" "Transferência 500.00 CVE enviada" "sms de envio"
contains_or_fail "$r" "Recebeu 500.00 CVE" "sms de receção"

echo "[8/8] Teste E2E concluído com sucesso ✅"
