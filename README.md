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

## Getting started

### 1. Clone the repository

```bash
git clone https://github.com/TiboKpa/Migration.git
cd Migration
```

### 2. Configure environment variables

```bash
cp .env.example .env
# Edit .env -- at minimum change DB_PASSWORD and JWT_SECRET
```

See [.env.example](.env.example) for all available variables.

### 3. Start with Docker Compose

```bash
docker compose up -d --build
```

| Service | Address |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:4000 |
| PostgreSQL | port 5432 (internal only) |

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

## Project structure

```
Migration/
  backend/
    db/
      init.sql           # PostgreSQL schema (auto-run by Docker)
    src/
      index.js           # Express entry point
      db.js              # Database connection pool
      middleware/        # JWT authentication middleware
      routes/            # API route handlers
        modules.js
        curricula.js
        playlists.js     # Trainings (playlists of curricula / modules)
        projects.js
        users.js
        templates.js
        campaigns.js
    Dockerfile
  frontend/
    src/
      pages/             # One file per page
        TrainingMatrixPage.jsx   # Modules / Curricula / Trainings tabs
        ...
      context/           # Auth context (JWT)
      api/               # Axios client
      utils/
        parseTrainingPathFlat.js  # xlsx import parser
    Dockerfile
    nginx.conf
  docker-compose.yml
  .env.example
```

## Pages

| Page | Route | Description |
|---|---|---|
| Dashboard | `/` | List of all projects |
| Project Overview | `/projects/:id` | Summary and quick stats |
| User List | `/projects/:id/users` | Manage project users |
| Training Matrix | `/projects/:id/matrix` | Modules, curricula and trainings |
| Templates | `/projects/:id/templates` | Email template editor |
| Mail Generation | `/projects/:id/generate` | Generate campaign emails |
| Campaign History | `/projects/:id/campaigns` | Sent campaign log |
| Settings | `/projects/:id/settings` | Project settings |

## Training Matrix

The Training Matrix page (`/projects/:id/matrix`) has three tabs:

- **Modules** -- Atomic learning units with an optional duration and Content ID.
- **Curricula** -- Ordered collections of modules, each with a mandatory/optional requirement flag.
  Drag-and-drop reordering is supported. The header shows total mandatory and total duration.
- **Trainings** -- Playlists that mix curricula and standalone modules in a defined sequence.
  Trainings can be _Primary_ (linked to a platform URL) or _Complementary_ (reference list).

You can import an existing training path from an `.xlsx` file using the **Import xlsx** button.

## API overview

| Resource | Base path |
|---|---|
| Projects | `/api/projects` |
| Users | `/api/projects/:id/users` |
| Modules | `/api/projects/:id/modules` |
| Curricula | `/api/projects/:id/curricula` |
| Trainings | `/api/projects/:id/playlists` |
| Templates | `/api/projects/:id/templates` |
| Campaigns | `/api/projects/:id/campaigns` |

All endpoints require a `Bearer` JWT token in the `Authorization` header except `/api/auth/login`.

## Authentication

The app uses JWT-based authentication. On first run the database seed creates a default admin
account -- check `backend/db/init.sql` for the default credentials and change them immediately.
