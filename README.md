# Migration - PDM Training Communication Web App

A multi-project web application for managing PDM migration training communications.

## Stack

- **Frontend**: React 18, Vite, Tailwind CSS, React Query
- **Backend**: Node.js, Express, PostgreSQL
- **Infrastructure**: Docker Compose

## Getting started

### 1. Clone the repository

```bash
git clone https://github.com/TiboKpa/Migration.git
cd Migration
```

### 2. Configure environment variables

```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Start with Docker Compose

```bash
docker compose up -d --build
```

Services:
- Frontend: http://localhost:3000
- Backend API: http://localhost:4000
- PostgreSQL: port 5432 (internal)

### 4. Development mode (without Docker)

**Backend**
```bash
cd backend
npm install
npm run dev
```

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

## Project structure

```
Migration/
  backend/
    db/init.sql        # PostgreSQL schema
    src/
      index.js         # Express entry point
      db.js            # Database connection
      middleware/      # JWT authentication
      routes/          # API routes
    Dockerfile
  frontend/
    src/
      pages/           # All application pages
      context/         # Auth context
      api/             # Axios client
    Dockerfile
    nginx.conf
  docker-compose.yml
  .env.example
```

## Pages

| Page | Route |
|---|---|
| Dashboard | `/` |
| Project Overview | `/projects/:id` |
| User List | `/projects/:id/users` |
| Training Matrix | `/projects/:id/matrix` |
| Templates | `/projects/:id/templates` |
| Mail Generation | `/projects/:id/generate` |
| Campaign History | `/projects/:id/campaigns` |
| Settings | `/projects/:id/settings` |
