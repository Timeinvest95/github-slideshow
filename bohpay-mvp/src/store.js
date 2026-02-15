const crypto = require('crypto');

function uuid() {
  return crypto.randomUUID();
}

class InMemoryStore {
  constructor() {
    this.users = [];
    this.wallets = [];
    this.transactions = [];
    this.ussdSessions = [];
    this.energyInvoices = [
      {
        id: uuid(),
        customerId: 'CV-10001',
        amount: 1250,
        status: 'UNPAID',
        reference: null
      },
      {
        id: uuid(),
        customerId: 'CV-10002',
        amount: 780,
        status: 'UNPAID',
        reference: null
      }
    ];
    this.agents = [];
    this.smsOutbox = [];
    this.idempotency = new Set();
  }

  findUserByPhone(phone) {
    return this.users.find((u) => u.phone === phone) || null;
  }

  createUser({ phone, name, pinHash }) {
    const user = {
      id: uuid(),
      phone,
      name,
      pin_hash: pinHash,
      status: 'ACTIVE',
      failed_attempts: 0,
      blocked_until: null,
      created_at: new Date().toISOString()
    };
    this.users.push(user);
    const wallet = {
      id: uuid(),
      user_id: user.id,
      balance: 0,
      currency: 'CVE'
    };
    this.wallets.push(wallet);
    return user;
  }

  getWalletByUserId(userId) {
    return this.wallets.find((w) => w.user_id === userId) || null;
  }

  createTransaction({ userId, type, amount, fee = 0, status = 'PENDING', reference, metadata = {} }) {
    const tx = {
      id: uuid(),
      user_id: userId,
      type,
      amount,
      fee,
      status,
      reference,
      metadata,
      created_at: new Date().toISOString()
    };
    this.transactions.push(tx);
    return tx;
  }

  getUserTransactions(userId, limit = 5) {
    return this.transactions
      .filter((t) => t.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }

  upsertSession({ sessionId, phone, state, context, expiresAt }) {
    const idx = this.ussdSessions.findIndex((s) => s.session_id === sessionId);
    const record = {
      session_id: sessionId,
      phone,
      state,
      context,
      expires_at: expiresAt.toISOString()
    };
    if (idx >= 0) {
      this.ussdSessions[idx] = record;
    } else {
      this.ussdSessions.push(record);
    }
    return record;
  }

  getSession(sessionId) {
    return this.ussdSessions.find((s) => s.session_id === sessionId) || null;
  }

  sendSms(phone, message) {
    this.smsOutbox.push({ phone, message, sent_at: new Date().toISOString() });
  }

  getDailyStats() {
    const today = new Date().toISOString().slice(0, 10);
    const todaysTx = this.transactions.filter((tx) => tx.created_at.startsWith(today));
    return {
      totalUsers: this.users.length,
      dailyVolume: todaysTx.filter((tx) => tx.status === 'SUCCESS').reduce((acc, tx) => acc + tx.amount, 0),
      failedTransactions: todaysTx.filter((tx) => tx.status === 'FAILED').length
    };
  }
}

module.exports = { InMemoryStore, uuid };
