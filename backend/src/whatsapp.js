const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js')
const qrcode = require('qrcode-terminal')

function WhatsappManager(io, prisma) {
  const sessions = {}

  const createSession = async (sessionName) => {
    if (sessions[sessionName] && sessions[sessionName].client) {
      return sessions[sessionName].client
    }

    // use first available user for now
    let user = await prisma.user.findFirst()
    if (!user) {
      const hashed = await require('bcryptjs').hash('default', 10)
      user = await prisma.user.create({
        data: { name: 'Default', email: 'default@example.com', password: hashed }
      })
    }

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: sessionName })
    })

    const mem = sessions[sessionName] || {}
    const existing = await prisma.session.findFirst({ where: { sessionName } })
    sessions[sessionName] = {
      client,
      webhook: mem.webhook || (existing && existing.webhook) || null
    }
    if (existing) {
      await prisma.session.update({
        where: { id: existing.id },
        data: { status: 'initializing' }
      })
    } else {
      await prisma.session.create({
        data: { sessionName, status: 'initializing', userId: user.id }
      })
    }

    client.on('qr', (qr) => {
      io.emit('qr', { session: sessionName, qr })
      qrcode.generate(qr, { small: true })
    })

    client.on('ready', async () => {
      io.emit('ready', { session: sessionName })
      const existing = await prisma.session.findFirst({ where: { sessionName } })
      if (existing) {
        await prisma.session.update({
          where: { id: existing.id },
          data: { status: 'ready' }
        })
      }
    })

    client.on('authenticated', () => {
      io.emit('authenticated', { session: sessionName })
    })

    client.on('disconnected', async (reason) => {
      io.emit('disconnected', { session: sessionName, reason })
      delete sessions[sessionName]
      const existing = await prisma.session.findFirst({ where: { sessionName } })
      if (existing) {
        await prisma.session.update({
          where: { id: existing.id },
          data: { status: 'disconnected' }
        })
      }
    })

    client.on('message', async (msg) => {
      io.emit('message', { session: sessionName, from: msg.from, body: msg.body });

      const session = sessions[sessionName];
      if (session && session.webhook) {
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

  const setWebhook = async (sessionName, url) => {
    const existing = await prisma.session.findFirst({ where: { sessionName } })
    if (existing) {
      await prisma.session.update({
        where: { id: existing.id },
        data: { webhook: url }
      })
    }

    if (!sessions[sessionName]) {
      sessions[sessionName] = { client: null, webhook: url }
    } else {
      sessions[sessionName].webhook = url
    }
  }

  return { createSession, getSession, setWebhook };
}

module.exports = WhatsappManager;
