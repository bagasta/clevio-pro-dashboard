const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js')
const qrcodeTerminal = require('qrcode-terminal')
const qrcode = require('qrcode')

function WhatsappManager(io, prisma) {
  // store whatsapp clients and runtime data
  const sessions = {}
  const log = (...args) => console.log('[whatsapp]', ...args)

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
    log('initializing session', sessionName)

    const mem = sessions[sessionName] || {}
    const existing = await prisma.session.findFirst({ where: { sessionName } })
    sessions[sessionName] = {
      client,
      status: 'initializing',
      qr: '',
      info: null,
      logs: mem.logs || [],
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
      log('qr received', sessionName)
      io.emit('qr', { session: sessionName, qr })
      qrcodeTerminal.generate(qr, { small: true })
      qrcode.toDataURL(qr).then(url => {
        sessions[sessionName].qr = url
        sessions[sessionName].status = 'scan'
      })
    })

    client.on('ready', async () => {
      log('ready', sessionName)
      io.emit('ready', { session: sessionName })
      sessions[sessionName].status = 'ready'
      sessions[sessionName].qr = ''
      sessions[sessionName].info = client.info
      const existing = await prisma.session.findFirst({ where: { sessionName } })
      if (existing) {
        await prisma.session.update({
          where: { id: existing.id },
          data: { status: 'ready' }
        })
      }
    })

    client.on('authenticated', () => {
      log('authenticated', sessionName)
      io.emit('authenticated', { session: sessionName })
    })

    client.on('disconnected', async (reason) => {
      log('disconnected', sessionName, reason)
      io.emit('disconnected', { session: sessionName, reason })
      if (sessions[sessionName]) {
        sessions[sessionName].status = 'disconnected'
        sessions[sessionName].client = null
      }
      const existing = await prisma.session.findFirst({ where: { sessionName } })
      if (existing) {
        await prisma.session.update({
          where: { id: existing.id },
          data: { status: 'disconnected' }
        })
      }
    })

    client.on('message', async (msg) => {
      log('message', sessionName, msg.from, msg.type)
      io.emit('message', { session: sessionName, from: msg.from, body: msg.body });
      if (sessions[sessionName]) {
        sessions[sessionName].logs.push({
          direction: 'in',
          from: msg.from,
          to: msg.to,
          type: msg.type,
          body: msg.body,
          timestamp: msg.timestamp
        })
      }

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
          })
          log('webhook call', session.webhook, response.status)
          if (response.ok) {
            const data = await response.json();
            if (data) {
              const to = data.to || msg.from;
              if (data.type === 'text' || !data.type) {
                if (data.message) {
                  await client.sendMessage(to, data.message);
                  sessions[sessionName].logs.push({
                    direction: 'out',
                    from: sessionName,
                    to,
                    type: 'text',
                    body: data.message,
                    timestamp: Math.floor(Date.now() / 1000)
                  });
                }
              } else if (['image', 'video', 'audio', 'document'].includes(data.type)) {
                const media = new MessageMedia(data.mimetype, data.media, data.filename);
                await client.sendMessage(to, media, { caption: data.caption });
                sessions[sessionName].logs.push({
                  direction: 'out',
                  from: sessionName,
                  to,
                  type: data.type,
                  body: data.caption || '',
                  timestamp: Math.floor(Date.now() / 1000)
                });
              }
            }
          }
        } catch (err) {
          console.error('Webhook error:', err);
        }
      }
    });

    client.initialize();
    log('client started', sessionName)

    return client;
  };

  const getSession = (sessionName) => sessions[sessionName] && sessions[sessionName].client;

  const getStatus = (sessionName) =>
    sessions[sessionName] ? { status: sessions[sessionName].status, info: sessions[sessionName].info } : null;

  const getQr = (sessionName) => sessions[sessionName] && sessions[sessionName].qr;

  const getLogs = (sessionName) => sessions[sessionName] ? sessions[sessionName].logs : [];

  const removeSession = async (sessionName) => {
    if (sessions[sessionName] && sessions[sessionName].client) {
      await sessions[sessionName].client.destroy();
      sessions[sessionName].client = null;
      sessions[sessionName].status = 'disconnected';
    }
  };

  const setWebhook = async (sessionName, url) => {
    const existing = await prisma.session.findFirst({ where: { sessionName } })
    if (existing) {
      await prisma.session.update({
        where: { id: existing.id },
        data: { webhook: url }
      })
    }

    log('store webhook', sessionName, url)

    if (!sessions[sessionName]) {
      sessions[sessionName] = {
        client: null,
        webhook: url,
        status: 'not initialized',
        qr: '',
        info: null,
        logs: []
      }
    } else {
      sessions[sessionName].webhook = url
    }
  }

  return { createSession, getSession, setWebhook, getStatus, getQr, getLogs, removeSession };
}

module.exports = WhatsappManager;
