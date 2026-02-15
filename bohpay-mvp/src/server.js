const http = require('http');
const { InMemoryStore } = require('./store');
const { WalletEngine } = require('./walletEngine');
const { UssdService } = require('./ussdService');

function createApp() {
  const store = new InMemoryStore();
  const walletEngine = new WalletEngine(store);
  const ussd = new UssdService(store, walletEngine);

  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/ussd') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const result = await ussd.handle(payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            responseType: result.end ? 'END' : 'CON',
            message: result.text
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload inválido', detail: err.message }));
        }
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/admin/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(store.getDailyStats()));
      return;
    }

    if (req.method === 'GET' && req.url === '/admin/logs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sms: store.smsOutbox, tx: store.transactions.slice(-20) }));
      return;
    }

    if (req.method === 'POST' && req.url === '/admin/agents') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body || '{}');
        store.agents.push({ id: `agent-${store.agents.length + 1}`, ...payload });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/admin/adjust-balance') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const { phone, amount } = JSON.parse(body || '{}');
        const user = store.findUserByPhone(phone);
        if (!user) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Utilizador não encontrado' }));
          return;
        }
        const wallet = store.getWalletByUserId(user.id);
        wallet.balance += Number(amount);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, balance: wallet.balance }));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return { server, store };
}

if (require.main === module) {
  const { server } = createApp();
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`BohPay MVP running on http://localhost:${port}`);
  });
}

module.exports = { createApp };
