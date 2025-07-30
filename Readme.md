### 📌 Deskripsi Project
Nama Project:
AI-Agent Dashboard with Multi-Session WhatsApp Integration

Tujuan:
Membuat aplikasi berbasis web yang memungkinkan pengguna dengan mudah membuat, mengelola, dan menjalankan AI Agent berbasis WhatsApp secara mandiri. Pengguna hanya perlu memilih template agent dan melakukan scan QR WhatsApp menggunakan WhatsApp Web.js. Aplikasi ini mampu menangani multi-session WhatsApp sekaligus untuk setiap pengguna, dengan manajemen akun berbasis JWT Authentication.

### Teknologi yang Digunakan:

Komponen	Teknologi
Frontend	React.js (CoreUI), Axios, Zustand, JWT Token Management
Backend	Node.js, Express.js, Prisma ORM, JWT, WhatsApp Web.js, Socket.io
Database	PostgreSQL (via Prisma)
Deployment	Docker, Docker Compose, Nginx Reverse Proxy

### 🚀 Langkah-Langkah Awal Project
1. Persiapan Repository GitHub
Buat repository baru di GitHub bernama:

```
ai-agent-dashboard
Clone repository ke lokal:
```

```
git clone https://github.com/your-username/ai-agent-dashboard.git
cd ai-agent-dashboard
```

2. Struktur Folder Awal
Struktur minimalis untuk project awal:

```
ai-agent-dashboard/
│
├── frontend/
│   └── (CoreUI React)
│
├── backend/
│   └── (Node.js + Express)
│
├── .gitignore
└── README.md
```

## Tambahkan .gitignore:
```
gitignore
Copy
Edit
node_modules
.env
dist
build
*.log
```


3. Inisialisasi Frontend (CoreUI React)
Jalankan di folder frontend:

```
npx create-react-app . --template coreui
Tambahkan dependensi dasar:
```
```
npm install axios zustand jwt-decode react-router-dom
```

4. Inisialisasi Backend (Node.js + Express)

Di folder backend:
```
npm init -y
npm install express cors dotenv jsonwebtoken bcryptjs prisma @prisma/client pg whatsapp-web.js socket.io qrcode-terminal
npm install --save-dev nodemon
```

Jalankan Prisma init:

```
npx prisma init
Setup .env backend (isi kredensial PostgreSQL):
```
env
```
DATABASE_URL="postgresql://user:password@localhost:5432/ai_agent_db"
JWT_SECRET="your_jwt_secret"
```

5. Konfigurasi Database PostgreSQL (Prisma)
Buat struktur awal tabel Prisma di backend/prisma/schema.prisma:

```
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int      @id @default(autoincrement())
  name      String
  email     String   @unique
  password  String
  sessions  Session[]
  agents    Agent[]
}

model Session {
  id          Int      @id @default(autoincrement())
  userId      Int
  sessionName String
  status      String
  user        User     @relation(fields: [userId], references: [id])
}

model Agent {
  id        Int      @id @default(autoincrement())
  userId    Int
  template  String
  config    Json
  user      User     @relation(fields: [userId], references: [id])
}
```

Migrasi awal database:
```
npx prisma migrate dev --name init
```
## Development Setup

Setelah repository diklon, jalankan `npm install` di masing-masing folder untuk mengunduh seluruh dependensi (termasuk `socket.io-client` yang dipakai halaman WhatsApp):

```bash
cd frontend && npm install
cd ../backend && npm install
npx prisma generate
```

Jalankan `npx prisma generate` kembali setiap kali schema pada folder `backend/prisma` diubah atau setelah menarik pembaruan terbaru agar Prisma Client selaras dengan database.

Kemudian jalankan server backend dan frontend pada terminal terpisah:

```bash
cd backend && npm start
cd ../frontend && npm start
```

Server events and incoming messages will be printed to the console. Check the
terminal running the backend for a detailed log of session status changes,
QR codes, webhook calls, and sent messages.

### WhatsApp API Endpoints

- `GET /api/sessions` – list sessions with their current status
- `POST /api/sessions` – create or update a session record
- `POST /api/sessions/:name` – initialize a WhatsApp session
- `PUT /api/sessions/:name/webhook` – register a webhook URL to receive incoming messages
- `DELETE /api/sessions/:name` – remove a session
- `GET /api/sessions/:name/qr` – fetch the latest QR code for authentication
- `GET /api/sessions/:name/status` – check connection status
- `GET /api/sessions/:name/logs` – retrieve recent message logs
- `POST /api/sessions/:name/send` – send a message. Body accepts:
  - `to` – destination number
  - `type` – `text`, `image`, `video`, `audio`, or `document`
  - `message` – text message when `type` is `text`
  - `media`/`mimetype`/`filename` – base64 data for media messages
  - `caption` – optional caption for media
