const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

function WhatsappManager(io) {
  const sessions = {};

  const createSession = (sessionName) => {
    if (sessions[sessionName]) {
      return sessions[sessionName];
    }

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: sessionName })
    });

    sessions[sessionName] = client;

    client.on('qr', (qr) => {
      io.emit('qr', { session: sessionName, qr });
      qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
      io.emit('ready', { session: sessionName });
    });

    client.on('authenticated', () => {
      io.emit('authenticated', { session: sessionName });
    });

    client.on('disconnected', (reason) => {
      io.emit('disconnected', { session: sessionName, reason });
      delete sessions[sessionName];
    });

    client.on('message', (msg) => {
      io.emit('message', { session: sessionName, from: msg.from, body: msg.body });
    });

    client.initialize();

    return client;
  };

  const getSession = (sessionName) => sessions[sessionName];

  return { createSession, getSession };
}

module.exports = WhatsappManager;
