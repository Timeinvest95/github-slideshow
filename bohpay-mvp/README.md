# 📲 BOHPAY – USSD WALLET (MVP 1.0 Funcional)

Este MVP implementa os fluxos principais pedidos:

- State machine USSD completa (START até END)
- Registo com PIN de 4 dígitos (hash seguro com scrypt)
- Consulta de saldo
- Transferência P2P com ledger por transações
- Pagamento de energia com fatura mock
- Sessões USSD com estado e contexto
- Rate limit (5 sessões/min por número)
- Bloqueio por PIN inválido (3 tentativas = 15 min)
- Idempotência (`sessionId + step + amount`)
- SMS outbox após operações `SUCCESS`
- Endpoints de backoffice admin (stats, logs, agente, ajuste saldo)

## Arquitetura implementada

Telemóvel → USSD Gateway (simulado via endpoint HTTP) → API BohPay (Node.js) → Core Wallet Engine → Store (modelo PostgreSQL em memória para MVP) → SMS/energia mock.

## Endpoints

### `POST /ussd`
Payload:

```json
{
  "sessionId": "abc123",
  "phoneNumber": "9912345",
  "text": "1"
}
```

Resposta:

```json
{
  "responseType": "CON",
  "message": "texto menu"
}
```

### Backoffice MVP
- `GET /admin/stats`
- `GET /admin/logs`
- `POST /admin/agents`
- `POST /admin/adjust-balance`

## Como correr

```bash
cd bohpay-mvp
npm start
```

## Testes

### Unit/Integration
```bash
cd bohpay-mvp
npm test
```

### E2E local (registo + saldo + P2P + logs SMS)
```bash
cd bohpay-mvp
npm run e2e
```

O script E2E está em `scripts/test-e2e.sh`.
