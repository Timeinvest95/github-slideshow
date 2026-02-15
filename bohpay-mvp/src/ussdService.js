const { hashPin, verifyPin } = require('./pinSecurity');

const STATES = {
  START: 'START',
  REGISTER_NAME: 'REGISTER_NAME',
  REGISTER_PIN: 'REGISTER_PIN',
  REGISTER_PIN_CONFIRM: 'REGISTER_PIN_CONFIRM',
  MENU_MAIN: 'MENU_MAIN',
  BALANCE_PIN: 'BALANCE_PIN',
  P2P_DEST: 'P2P_DEST',
  P2P_VALUE: 'P2P_VALUE',
  P2P_CONFIRM: 'P2P_CONFIRM',
  P2P_PIN: 'P2P_PIN',
  BILL_CUSTOMER_ID: 'BILL_CUSTOMER_ID',
  BILL_CONFIRM: 'BILL_CONFIRM',
  BILL_PIN: 'BILL_PIN',
  HISTORY: 'HISTORY',
  SETTINGS: 'SETTINGS',
  CHANGE_PIN_OLD: 'CHANGE_PIN_OLD',
  CHANGE_PIN_NEW: 'CHANGE_PIN_NEW',
  CHANGE_PIN_CONFIRM: 'CHANGE_PIN_CONFIRM',
  END: 'END'
};

class UssdService {
  constructor(store, walletEngine) {
    this.store = store;
    this.walletEngine = walletEngine;
    this.rateWindowMs = 60_000;
    this.maxSessionsPerMinute = 5;
    this.sessionHits = new Map();
  }

  touchRate(phone, isNewSession) {
    if (!isNewSession) return true;
    const now = Date.now();
    const key = phone;
    const all = (this.sessionHits.get(key) || []).filter((ts) => now - ts < this.rateWindowMs);
    all.push(now);
    this.sessionHits.set(key, all);
    return all.length <= this.maxSessionsPerMinute;
  }

  ensureSession(sessionId, phone) {
    const existing = this.store.getSession(sessionId);
    if (existing && new Date(existing.expires_at).getTime() > Date.now()) {
      return existing;
    }
    return this.store.upsertSession({
      sessionId,
      phone,
      state: STATES.START,
      context: {},
      expiresAt: new Date(Date.now() + 3 * 60_000)
    });
  }

  persist(sessionId, phone, state, context) {
    return this.store.upsertSession({
      sessionId,
      phone,
      state,
      context,
      expiresAt: new Date(Date.now() + 3 * 60_000)
    });
  }

  menuMain() {
    return 'BohPay\n1. Saldo\n2. Transferir\n3. Pagar Energia\n4. Histórico\n5. Definições\n0. Sair';
  }

  async handle({ sessionId, phoneNumber, text }) {
    const existingSession = this.store.getSession(sessionId);
    if (!this.touchRate(phoneNumber, !existingSession)) {
      return { end: true, text: 'Muitas tentativas. Tente novamente em instantes.' };
    }

    const session = this.ensureSession(sessionId, phoneNumber);
    const input = (text || '').trim();
    const user = this.store.findUserByPhone(phoneNumber);
    const context = session.context || {};

    if (session.state === STATES.START) {
      if (!user) {
        if (!input) {
          return { cont: true, text: 'Bem-vindo ao BohPay\n1. Criar conta\n0. Sair' };
        }
        if (input === '1') {
          this.persist(sessionId, phoneNumber, STATES.REGISTER_NAME, {});
          return { cont: true, text: 'Insira o seu nome:' };
        }
        return { end: true, text: 'Até breve.' };
      }

      this.persist(sessionId, phoneNumber, STATES.MENU_MAIN, {});
      return { cont: true, text: this.menuMain() };
    }

    if (user && user.blocked_until && new Date(user.blocked_until).getTime() > Date.now()) {
      return { end: true, text: 'Conta bloqueada temporariamente. Tente mais tarde.' };
    }

    switch (session.state) {
      case STATES.REGISTER_NAME:
        context.name = input;
        this.persist(sessionId, phoneNumber, STATES.REGISTER_PIN, context);
        return { cont: true, text: 'Crie um PIN de 4 dígitos:' };

      case STATES.REGISTER_PIN:
        if (!/^\d{4}$/.test(input)) {
          return { cont: true, text: 'PIN inválido. Digite 4 números:' };
        }
        context.pin = input;
        this.persist(sessionId, phoneNumber, STATES.REGISTER_PIN_CONFIRM, context);
        return { cont: true, text: 'Confirme o PIN:' };

      case STATES.REGISTER_PIN_CONFIRM:
        if (input !== context.pin) {
          this.persist(sessionId, phoneNumber, STATES.REGISTER_PIN, { name: context.name });
          return { cont: true, text: 'PIN não coincide. Crie novamente:' };
        }
        const hash = hashPin(input);
        this.store.createUser({ phone: phoneNumber, name: context.name, pinHash: hash });
        this.persist(sessionId, phoneNumber, STATES.MENU_MAIN, {});
        return { cont: true, text: 'Conta criada com sucesso.\n1. Menu principal' };

      case STATES.MENU_MAIN:
        if (input === '1') {
          this.persist(sessionId, phoneNumber, STATES.BALANCE_PIN, {});
          return { cont: true, text: 'Digite o PIN para ver saldo:' };
        }
        if (input === '2') {
          this.persist(sessionId, phoneNumber, STATES.P2P_DEST, {});
          return { cont: true, text: 'Número do destinatário:' };
        }
        if (input === '3') {
          this.persist(sessionId, phoneNumber, STATES.BILL_CUSTOMER_ID, {});
          return { cont: true, text: 'Insira número do contador:' };
        }
        if (input === '4') {
          const txs = this.store.getUserTransactions(user.id);
          const lines = txs.length
            ? txs.map((t) => `${t.type} ${t.amount} (${t.status})`).join('\n')
            : 'Sem transações.';
          this.persist(sessionId, phoneNumber, STATES.MENU_MAIN, {});
          return { cont: true, text: `Histórico:\n${lines}\n\n${this.menuMain()}` };
        }
        if (input === '5') {
          this.persist(sessionId, phoneNumber, STATES.SETTINGS, {});
          return { cont: true, text: 'Definições\n1. Alterar PIN\n0. Voltar' };
        }
        return { end: true, text: 'Sessão terminada.' };

      case STATES.BALANCE_PIN:
        if (!(verifyPin(input, user.pin_hash))) {
          user.failed_attempts += 1;
          if (user.failed_attempts >= 3) {
            user.blocked_until = new Date(Date.now() + 15 * 60_000).toISOString();
            user.failed_attempts = 0;
            return { end: true, text: 'Conta bloqueada por 15 minutos.' };
          }
          return { cont: true, text: 'PIN inválido.' };
        }
        user.failed_attempts = 0;
        const balance = this.store.getWalletByUserId(user.id).balance;
        this.persist(sessionId, phoneNumber, STATES.MENU_MAIN, {});
        return { cont: true, text: `Saldo atual: ${balance.toFixed(2)} CVE\n\n${this.menuMain()}` };

      case STATES.P2P_DEST:
        context.dest = input;
        this.persist(sessionId, phoneNumber, STATES.P2P_VALUE, context);
        return { cont: true, text: 'Valor a transferir (CVE):' };

      case STATES.P2P_VALUE:
        context.amount = Number(input);
        this.persist(sessionId, phoneNumber, STATES.P2P_CONFIRM, context);
        return { cont: true, text: `Confirmar transferência para ${context.dest} de ${context.amount} CVE?\n1. Confirmar\n0. Cancelar` };

      case STATES.P2P_CONFIRM:
        if (input !== '1') {
          this.persist(sessionId, phoneNumber, STATES.MENU_MAIN, {});
          return { cont: true, text: this.menuMain() };
        }
        this.persist(sessionId, phoneNumber, STATES.P2P_PIN, context);
        return { cont: true, text: 'Digite o seu PIN:' };

      case STATES.P2P_PIN:
        if (!(verifyPin(input, user.pin_hash))) {
          return { end: true, text: 'PIN inválido. Operação cancelada.' };
        }
        const receiver = this.store.findUserByPhone(context.dest);
        if (!receiver) {
          return { end: true, text: 'Destinatário não existe.' };
        }
        const p2pResult = this.walletEngine.transferP2P({
          sender: user,
          receiver,
          amount: context.amount,
          idempotencyKey: `${sessionId}:${session.state}:${context.amount}`
        });
        this.persist(sessionId, phoneNumber, STATES.END, {});
        return { end: true, text: p2pResult.success ? `Transferência concluída. Ref: ${p2pResult.reference}` : p2pResult.reason };

      case STATES.BILL_CUSTOMER_ID:
        context.customerId = input;
        const invoice = this.store.energyInvoices.find((inv) => inv.customerId === input && inv.status === 'UNPAID');
        if (!invoice) {
          return { end: true, text: 'Fatura não encontrada.' };
        }
        context.amount = invoice.amount;
        this.persist(sessionId, phoneNumber, STATES.BILL_CONFIRM, context);
        return { cont: true, text: `Dívida encontrada: ${invoice.amount} CVE\n1. Pagar\n0. Cancelar` };

      case STATES.BILL_CONFIRM:
        if (input !== '1') {
          return { end: true, text: 'Pagamento cancelado.' };
        }
        this.persist(sessionId, phoneNumber, STATES.BILL_PIN, context);
        return { cont: true, text: 'Digite PIN para confirmar:' };

      case STATES.BILL_PIN:
        if (!(verifyPin(input, user.pin_hash))) {
          return { end: true, text: 'PIN inválido.' };
        }
        const billResult = this.walletEngine.payEnergy({
          user,
          customerId: context.customerId,
          amount: context.amount,
          idempotencyKey: `${sessionId}:${session.state}:${context.amount}`
        });
        this.persist(sessionId, phoneNumber, STATES.END, {});
        return { end: true, text: billResult.success ? `Pagamento concluído. Ref: ${billResult.reference}` : billResult.reason };

      case STATES.SETTINGS:
        if (input === '1') {
          this.persist(sessionId, phoneNumber, STATES.CHANGE_PIN_OLD, {});
          return { cont: true, text: 'PIN atual:' };
        }
        this.persist(sessionId, phoneNumber, STATES.MENU_MAIN, {});
        return { cont: true, text: this.menuMain() };

      case STATES.CHANGE_PIN_OLD:
        if (!(verifyPin(input, user.pin_hash))) {
          return { end: true, text: 'PIN atual inválido.' };
        }
        this.persist(sessionId, phoneNumber, STATES.CHANGE_PIN_NEW, {});
        return { cont: true, text: 'Novo PIN (4 dígitos):' };

      case STATES.CHANGE_PIN_NEW:
        if (!/^\d{4}$/.test(input)) {
          return { cont: true, text: 'PIN inválido. Digite 4 dígitos:' };
        }
        context.newPin = input;
        this.persist(sessionId, phoneNumber, STATES.CHANGE_PIN_CONFIRM, context);
        return { cont: true, text: 'Confirme novo PIN:' };

      case STATES.CHANGE_PIN_CONFIRM:
        if (input !== context.newPin) {
          return { end: true, text: 'PINs diferentes. Operação cancelada.' };
        }
        user.pin_hash = hashPin(input);
        return { end: true, text: 'PIN alterado com sucesso.' };

      default:
        return { end: true, text: 'Sessão encerrada.' };
    }
  }
}

module.exports = { UssdService, STATES };
