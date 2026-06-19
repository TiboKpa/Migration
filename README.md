# Migration - Web App

A multi-project web application for managing PDM migration training communications.
It lets you build a full training catalogue (modules, curricula, trainings) and generate
communication campaigns from configurable email templates.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS |
| Backend | Node.js, Express |
| Database | PostgreSQL |
| Infrastructure | Docker Compose |

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/TiboKpa/Migration.git
cd Migration
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Then open `.env` and set **all three required values** before starting:

| Variable | Description |
|---|---|
| `DB_PASSWORD` | Strong password for PostgreSQL. The server refuses to start with the placeholder. |
| `JWT_SECRET` | At least 32 random characters. Generate with `openssl rand -hex 32`. The server refuses to start with the placeholder. |
| `ALLOWED_ORIGIN` | Exact URL of your frontend as seen by the browser (e.g. `https://app.example.com`). No trailing slash. |

See [.env.example](.env.example) for all available variables and inline guidance.

### 3. Start with Docker Compose

```bash
docker compose up -d --build
```

| Service | Address |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:4000 |
| PostgreSQL | port 5432 (internal, not exposed) |

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

The frontend dev server proxies `/api` requests to `http://localhost:4000` automatically.

---

## Project Structure

```
Migration/
  backend/
    db/
      init.sql           # PostgreSQL schema (auto-run by Docker)
    src/
      index.js           # Express entry point
      db.js              # Database connection pool
      migrate.js         # Schema migration runner
      middleware/
        auth.js          # JWT authentication (verifies token, fetches user from DB)
        requireMember.js # Project membership guard (verifies user belongs to project)
      routes/
        auth.js          # POST /api/auth/register, /api/auth/login
        projects.js      # CRUD /api/projects
        userList.js      # /api/projects/:id/users
        trainingMatrix.js
        templates.js
        generation.js
        campaigns.js
        roleMatrix.js
    Dockerfile
    package.json
  frontend/
    src/
      pages/             # One file per page
      context/           # Auth context (JWT)
      api/               # Axios client
      utils/
        parseTrainingPathFlat.js  # Training path import parser
    Dockerfile
    nginx.conf
  docker-compose.yml
  .env.example
  SECURITY.md
```

---

## Pages

| Page | Route | Description |
|---|---|---|
| Dashboard | `/` | List of all projects |
| Project Overview | `/projects/:id` | Summary and quick stats |
| User List | `/projects/:id/users` | Manage project users |
| Training Matrix | `/projects/:id/matrix` | Modules, curricula and trainings |
| Role Matrix | `/projects/:id/role-matrix` | Function/role training assignment |
| Templates | `/projects/:id/templates` | Email template editor |
| Mail Generation | `/projects/:id/generate` | Generate campaign emails |
| Campaign History | `/projects/:id/campaigns` | Sent campaign log |
| Settings | `/projects/:id/settings` | Project settings |

---

## Training Matrix

The Training Matrix page (`/projects/:id/matrix`) has three tabs:

- **Modules** -- Atomic learning units with an optional duration and Content ID.
- **Curricula** -- Ordered collections of modules, each with a mandatory/optional requirement flag.
  Drag-and-drop reordering is supported. The header shows total mandatory and total duration.
- **Trainings** -- Playlists that mix curricula and standalone modules in a defined sequence.
  Trainings can be Primary (linked to a platform URL) or Complementary (reference list).

You can import an existing training path from a JSON export using the **Import** button on each tab.

---

## API Overview

All endpoints require a `Bearer <token>` JWT in the `Authorization` header, except `POST /api/auth/login` and `POST /api/auth/register`.

Project sub-resource endpoints additionally verify that the authenticated user is a member of the requested project. Non-members receive `403 Forbidden`.

| Resource | Base path |
|---|---|
| Auth | `/api/auth` |
| Projects | `/api/projects` |
| Users | `/api/projects/:id/users` |
| Training Matrix | `/api/projects/:id/` |
| Role Matrix | `/api/projects/:id/role-matrix` |
| Templates | `/api/projects/:id/templates` |
| Generation | `/api/projects/:id/generate` |
| Campaigns | `/api/projects/:id/campaigns` |

### Rate Limiting

- All routes are subject to a **global limit of 300 requests per 15-minute window** per IP.
- Auth endpoints (`/api/auth/login`, `/api/auth/register`) are additionally limited to **20 requests per 15-minute window** per IP.
- The preview generation endpoint (`POST /api/projects/:id/generate/preview`) has a stricter limit of **30 requests per minute** per IP due to its database and rendering cost.
- Exceeding any limit returns `429 Too Many Requests`.

---

## Authentication

The app uses JWT-based authentication.

- Tokens are signed with `JWT_SECRET` and expire after **8 hours**.
- The token payload contains only the user ID. Email and name are fetched from the database on each request.
- On first run, check `backend/db/init.sql` for any seed account and change its credentials immediately.

---

## Security

See [SECURITY.md](SECURITY.md) for the full security model, implemented controls, and deployment hardening checklist.

---

## Branch Strategy

| Branch | Purpose |
|---|---|
| `main` | Stable, production-ready code |
| `dev` | Active development and integration |

Open pull requests against `dev`. Merge to `main` after review.
