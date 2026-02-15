const { uuid } = require('./store');

class WalletEngine {
  constructor(store) {
    this.store = store;
  }

  transferP2P({ sender, receiver, amount, idempotencyKey }) {
    if (this.store.idempotency.has(idempotencyKey)) {
      return { duplicate: true, reference: 'IDEMPOTENT' };
    }

    const senderWallet = this.store.getWalletByUserId(sender.id);
    const receiverWallet = this.store.getWalletByUserId(receiver.id);

    const ref = uuid().slice(0, 8).toUpperCase();
    const senderTx = this.store.createTransaction({
      userId: sender.id,
      type: 'P2P_SEND',
      amount,
      status: 'PENDING',
      reference: ref,
      metadata: { to: receiver.phone }
    });
    const receiverTx = this.store.createTransaction({
      userId: receiver.id,
      type: 'P2P_RECEIVE',
      amount,
      status: 'PENDING',
      reference: ref,
      metadata: { from: sender.phone }
    });

    if (!senderWallet || !receiverWallet || senderWallet.balance < amount) {
      senderTx.status = 'FAILED';
      receiverTx.status = 'FAILED';
      return { success: false, reason: 'Saldo insuficiente.' };
    }

    senderWallet.balance -= amount;
    receiverWallet.balance += amount;
    senderTx.status = 'SUCCESS';
    receiverTx.status = 'SUCCESS';
    this.store.idempotency.add(idempotencyKey);

    this.store.sendSms(
      sender.phone,
      `BohPay: Transferência ${amount.toFixed(2)} CVE enviada. TxID: ${ref}. Saldo atual: ${senderWallet.balance.toFixed(2)} CVE`
    );
    this.store.sendSms(
      receiver.phone,
      `BohPay: Recebeu ${amount.toFixed(2)} CVE de ${sender.phone}. TxID: ${ref}. Saldo atual: ${receiverWallet.balance.toFixed(2)} CVE`
    );

    return { success: true, reference: ref };
  }

  payEnergy({ user, customerId, amount, idempotencyKey }) {
    if (this.store.idempotency.has(idempotencyKey)) {
      return { duplicate: true, reference: 'IDEMPOTENT' };
    }

    const wallet = this.store.getWalletByUserId(user.id);
    const invoice = this.store.energyInvoices.find((inv) => inv.customerId === customerId && inv.status === 'UNPAID');
    const ref = uuid().slice(0, 8).toUpperCase();

    const tx = this.store.createTransaction({
      userId: user.id,
      type: 'BILL',
      amount,
      status: 'PENDING',
      reference: ref,
      metadata: { customerId }
    });

    if (!wallet || wallet.balance < amount || !invoice) {
      tx.status = 'FAILED';
      return { success: false, reason: 'Fatura inexistente ou saldo insuficiente.' };
    }

    wallet.balance -= amount;
    tx.status = 'SUCCESS';
    invoice.status = 'PAID';
    invoice.reference = ref;
    this.store.idempotency.add(idempotencyKey);

    this.store.sendSms(
      user.phone,
      `BohPay: Pagamento energia ${amount.toFixed(2)} CVE concluído. Ref: ${ref}. Saldo: ${wallet.balance.toFixed(2)} CVE`
    );

    return { success: true, reference: ref };
  }
}

module.exports = { WalletEngine };
