require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');
const { MessageMedia } = require('whatsapp-web.js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;
const SECRET_KEY = process.env.JWT_SECRET || 'supersecret';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const N8N_API_BASE = process.env.N8N_API_BASE || 'https://n8n.chiefaiofficer.id';
const N8N_API_KEY = process.env.N8N_API_KEY || '';

// log helper
const log = (...args) => console.log('[server]', ...args)

async function ensureDefaultUser() {
  const count = await prisma.user.count()
  if (count === 0) {
    const hashed = await bcrypt.hash('default', 10)
    await prisma.user.create({
      data: { name: 'Default', email: 'default@example.com', password: hashed }
    })
    log('created default user')
  }
}

ensureDefaultUser()

const WhatsappManager = require('./whatsapp');
const whatsapp = WhatsappManager(io, prisma);

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  if (
    req.path === '/api/login' ||
    req.path === '/api/register' ||
    req.path === '/api/refresh' ||
    /^\/api\/sessions\/[^/]+\/qr/.test(req.path)
  ) {
    return next();
  }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    jwt.verify(auth.split(' ')[1], SECRET_KEY);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalid' });
  }
});

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    SECRET_KEY,
    { expiresIn: '1h' }
  );
}

app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { name, email, password: hashed } });
    const token = generateToken(user);
    log('registered user', email)
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = generateToken(user);
    log('login success', email)
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/refresh', (req, res) => {
  try {
    const { token } = req.body;
    const decoded = jwt.verify(token, SECRET_KEY, { ignoreExpiration: true });
    if (!decoded.id) return res.status(401).json({ error: 'Invalid token' });
    const newToken = jwt.sign({ id: decoded.id, email: decoded.email }, SECRET_KEY, { expiresIn: '1h' });
    res.json({ token: newToken });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const rows = await prisma.session.findMany()
    const data = rows.map(row => ({
      ...row,
      status: whatsapp.getStatus(row.sessionName)?.status || 'not initialized'
    }))
    res.json(data)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch sessions' })
  }
})

app.post('/api/sessions', async (req, res) => {
  const { sessionName, webhook } = req.body
  if (!sessionName) return res.status(400).json({ error: 'sessionName required' })
  try {
    const existing = await prisma.session.findFirst({ where: { sessionName } })
    let row
    if (existing) {
      row = await prisma.session.update({ where: { id: existing.id }, data: { webhook } })
    } else {
      row = await prisma.session.create({ data: { sessionName, status: 'not initialized', webhook, userId: 1 } })
    }
    res.json(row)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to save session' })
  }
})

app.post('/api/sessions/:name', async (req, res) => {
  try {
    await whatsapp.createSession(req.params.name)
    log('create session', req.params.name)
    res.json({ status: 'initializing' })
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.put('/api/sessions/:name/webhook', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    await whatsapp.setWebhook(req.params.name, url)
    log('set webhook', req.params.name, url)
    res.json({ status: 'ok' })
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to set webhook' });
  }
});

app.post('/api/sessions/:name/send', async (req, res) => {
  const { to, type = 'text', message, media, mimetype, filename, caption } = req.body;
  const client = whatsapp.getSession(req.params.name);
  if (!client) {
    return res.status(404).json({ error: 'Session not found' });
  }
  try {
    let result;
    if (type === 'text' || !type) {
      result = await client.sendMessage(to, message);
    } else if (['image', 'video', 'audio', 'document'].includes(type)) {
      const mediaMsg = new MessageMedia(mimetype, media, filename);
      result = await client.sendMessage(to, mediaMsg, { caption });
    } else {
      return res.status(400).json({ error: 'Unsupported type' });
    }
    log('send message', req.params.name, to, type)
    res.json({ status: 'sent', id: result.id._serialized });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

app.get('/api/sessions/:name/qr', (req, res) => {
  const qr = whatsapp.getQr(req.params.name)
  if (qr === undefined) return res.status(404).json({ error: 'Session not initialized' })
  res.json({ qr })
})

app.get('/api/sessions/:name/status', (req, res) => {
  const status = whatsapp.getStatus(req.params.name)
  if (!status) return res.status(404).json({ status: 'not initialized' })
  res.json(status)
})

app.get('/api/sessions/:name/logs', (req, res) => {
  const logs = whatsapp.getLogs(req.params.name)
  res.json({ logs })
})

app.delete('/api/sessions/:name', async (req, res) => {
  try {
    await whatsapp.removeSession(req.params.name)
    await prisma.session.deleteMany({ where: { sessionName: req.params.name } })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to delete session' })
  }
})

app.post('/api/proxy/n8n/workflows', async (req, res) => {
  try {
    const result = await axios.post(
      `${N8N_API_BASE}/api/v1/workflows`,
      req.body,
      { headers: { 'X-N8N-API-KEY': N8N_API_KEY } }
    )
    res.json(result.data)
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.message, detail: e.response?.data })
  }
})

server.listen(PORT, () => {
  log(`Server running on port ${PORT}`)
})
