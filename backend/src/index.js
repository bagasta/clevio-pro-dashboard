require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');
const { MessageMedia } = require('whatsapp-web.js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

async function ensureDefaultUser() {
  const count = await prisma.user.count()
  if (count === 0) {
    const hashed = await bcrypt.hash('default', 10)
    await prisma.user.create({
      data: { name: 'Default', email: 'default@example.com', password: hashed }
    })
  }
}

ensureDefaultUser()

const WhatsappManager = require('./whatsapp');
const whatsapp = WhatsappManager(io, prisma);

app.use(cors());
app.use(express.json());

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
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
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await prisma.session.findMany()
    res.json(sessions)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch sessions' })
  }
})

app.post('/api/sessions/:name', async (req, res) => {
  try {
    await whatsapp.createSession(req.params.name)
    res.json({ status: 'initializing' })
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

app.post('/api/sessions/:name/webhook', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    await whatsapp.setWebhook(req.params.name, url)
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
    res.json({ status: 'sent', id: result.id._serialized });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
