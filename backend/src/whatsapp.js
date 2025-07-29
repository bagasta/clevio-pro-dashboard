const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

function WhatsappManager(io) {
  const sessions = {};

  const createSession = (sessionName) => {
    if (sessions[sessionName]) {
      return sessions[sessionName].client;
    }

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: sessionName })
    });

    sessions[sessionName] = { client, webhook: null };

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

    client.on('message', async (msg) => {
      io.emit('message', { session: sessionName, from: msg.from, body: msg.body });

      const session = sessions[sessionName];
      if (session.webhook) {
        const payload = { from: msg.from, body: msg.body, type: msg.type };
        if (msg.hasMedia) {
          const media = await msg.downloadMedia();
          if (media) {
            payload.media = media.data;
            payload.mimetype = media.mimetype;
            payload.filename = media.filename;
          }
        }
        try {
          const response = await fetch(session.webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (response.ok) {
            const data = await response.json();
            if (data) {
              const to = data.to || msg.from;
              if (data.type === 'text' || !data.type) {
                if (data.message) await client.sendMessage(to, data.message);
              } else if (['image', 'video', 'audio', 'document'].includes(data.type)) {
                const media = new MessageMedia(data.mimetype, data.media, data.filename);
                await client.sendMessage(to, media, { caption: data.caption });
              }
            }
          }
        } catch (err) {
          console.error('Webhook error:', err);
        }
      }
    });

    client.initialize();

    return client;
  };

  const getSession = (sessionName) => sessions[sessionName] && sessions[sessionName].client;

  const setWebhook = (sessionName, url) => {
    if (sessions[sessionName]) {
      sessions[sessionName].webhook = url;
    }
  };

  return { createSession, getSession, setWebhook };
}

module.exports = WhatsappManager;
