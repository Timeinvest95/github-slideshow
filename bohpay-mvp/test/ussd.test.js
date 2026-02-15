const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../src/server');

async function postJson(port, path, payload) {
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(body) }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

test('deve registar conta e consultar saldo', async () => {
  const { server } = createApp();
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const sid = 'sess-1';
  const phone = '9911111';

  let r = await postJson(port, '/ussd', { sessionId: sid, phoneNumber: phone, text: '' });
  assert.equal(r.json.responseType, 'CON');

  await postJson(port, '/ussd', { sessionId: sid, phoneNumber: phone, text: '1' });
  await postJson(port, '/ussd', { sessionId: sid, phoneNumber: phone, text: 'Ana' });
  await postJson(port, '/ussd', { sessionId: sid, phoneNumber: phone, text: '1234' });
  r = await postJson(port, '/ussd', { sessionId: sid, phoneNumber: phone, text: '1234' });

  assert.match(r.json.message, /Conta criada com sucesso/);

  server.close();
});

test('deve fazer transferência p2p com sucesso', async () => {
  const { server } = createApp();
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  async function register(phone, sid) {
    await postJson(port, '/ussd', { sessionId: sid, phoneNumber: phone, text: '' });
    await postJson(port, '/ussd', { sessionId: sid, phoneNumber: phone, text: '1' });
    await postJson(port, '/ussd', { sessionId: sid, phoneNumber: phone, text: `User${phone}` });
    await postJson(port, '/ussd', { sessionId: sid, phoneNumber: phone, text: '1234' });
    await postJson(port, '/ussd', { sessionId: sid, phoneNumber: phone, text: '1234' });
  }

  await register('9922222', 's2');
  await register('9933333', 's3');

  await postJson(port, '/admin/adjust-balance', { phone: '9922222', amount: 2000 });

  await postJson(port, '/ussd', { sessionId: 's4', phoneNumber: '9922222', text: '' });
  await postJson(port, '/ussd', { sessionId: 's4', phoneNumber: '9922222', text: '2' });
  await postJson(port, '/ussd', { sessionId: 's4', phoneNumber: '9922222', text: '9933333' });
  await postJson(port, '/ussd', { sessionId: 's4', phoneNumber: '9922222', text: '500' });
  await postJson(port, '/ussd', { sessionId: 's4', phoneNumber: '9922222', text: '1' });
  const r = await postJson(port, '/ussd', { sessionId: 's4', phoneNumber: '9922222', text: '1234' });

  assert.equal(r.json.responseType, 'END');
  assert.match(r.json.message, /Transferência concluída/);

  server.close();
});
