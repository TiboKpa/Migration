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
        parseTrainingPathFlat.js  # Training path Excel import parser
        reResolveRoleMatrix.js    # Re-resolves role matrix after training changes
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

Use the **Import Excel** button to bulk-import a training path from a `.xlsx` file.
Use the **Export Excel** button to download the current catalogue as a `.xlsx` file.

---

## Role Matrix

The Role Matrix page (`/projects/:id/role-matrix`) maps every Function/Role combination to:

- A **Primary Training** (recommended playlist)
- One or more **Complementary Trainings** (curricula or standalone modules)
- A **TLG Group** assignment (primary group + optional add-ons)

### Filters

Three compact filter panels at the top of the page let you narrow the table by Function, Role, and Additional Info flags. Each panel is independently scrollable.

### Status indicators

Rows are colour-coded to show their resolution state:

| Colour | Meaning |
|---|---|
| White | Fully resolved |
| Orange | Primary training name not matched to a playlist |
| Yellow | One or more complementary trainings not matched |
| Red | No training assigned at all |
| Grey | Marked as N/A |

### Import and Export

- **Import Excel** -- Load a role matrix spreadsheet (`.xlsx`). The importer reads Function, Role, PDM Role, TLG Group, and Additional Info columns and creates or updates rows accordingly.
- **Export Excel** -- Download the current role matrix as a `.xlsx` file in the same format accepted by Import.

### Horizontal scroll

The matrix table has a defined minimum width. On narrow viewports a horizontal scrollbar appears so the **Fill** button at the end of each row remains reachable without layout changes.

---

## User List

The User List page (`/projects/:id/users`) manages the people in scope for the migration.

### Excel Import

The importer locates the header row by scanning for the `SESA ID` column label, so leading metadata rows in the spreadsheet are skipped automatically. Parsing rules:

- **Empty SESA cell signals end of data.** The parser stops at the first empty SESA cell rather than scanning blank rows to the end of the sheet. Place your data contiguously with no gaps.
- **Excel date serials are converted automatically.** `Last contact` cells stored as Excel integer date serials (e.g. `46174`) are converted to `YYYY-MM-DD` format. ISO strings are also accepted.
- **Template hint rows are ignored.** If the row immediately after the header repeats the column label (a common template pattern), it is skipped.
- **Training (auto) and TLG (auto) columns are not read from the file.** They are always re-derived from the Role Matrix after import.

### Auto-sync after load

Every time the user list is loaded, the app automatically re-queries the Role Matrix for every user that has a Function and Role assigned, and updates their Training and TLG values if the matrix has changed since the last save. A `Syncing training & TLG...` indicator appears in the header subtitle while this is running. Users without a Function/Role are not affected.

### Edit mode

Enable **Edit mode** with the toggle to add, modify, or delete users. Changes are saved automatically when you click away from a row or press Enter. Selecting a Function/Role in a row immediately triggers a matrix lookup and fills Training and TLG.

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

### Notable endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/projects/:id/users/import-json` | Bulk-import users parsed client-side from Excel |
| DELETE | `/api/projects/:id/users` | Delete all users in a project |
| POST | `/api/projects/:id/role-matrix/lookup` | Resolve Training and TLG for a given Function/Role/Additional Info combination |

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

## Dependencies

### Backend (`backend/package.json`)

| Package | Version | License | Purpose |
|---|---|---|---|
| `express` | ^4.19.2 | MIT | HTTP server and routing |
| `bcryptjs` | ^2.4.3 | MIT | Password hashing (cost factor 12) |
| `cors` | ^2.8.5 | MIT | CORS header management |
| `dotenv` | ^16.4.5 | BSD-2-Clause | Environment variable loading |
| `exceljs` | ^4.4.0 | MIT | Server-side Excel parsing for bulk imports |
| `express-rate-limit` | ^7.3.1 | MIT | Rate limiting middleware |
| `helmet` | ^7.1.0 | MIT | Security headers (CSP, HSTS, etc.) |
| `jsonwebtoken` | ^9.0.2 | MIT | JWT signing and verification |
| `morgan` | ^1.10.0 | MIT | HTTP request logging |
| `multer` | ^1.4.5-lts.1 | MIT | Multipart file upload handling |
| `pg` | ^8.12.0 | MIT | PostgreSQL client |
| `zod` | ^3.23.8 | MIT | Request body validation schemas |
| `nodemon` *(dev)* | ^3.1.4 | MIT | Auto-restart during development |

All backend dependencies are MIT or BSD-2-Clause. Both licences are permissive and permit commercial use with no restrictions beyond retaining copyright notices.

### Frontend (`frontend/package.json`)

| Package | Version | License | Purpose |
|---|---|---|---|
| `react` | ^18.3.1 | MIT | UI rendering |
| `react-dom` | ^18.3.1 | MIT | DOM renderer for React |
| `react-router-dom` | ^6.24.1 | MIT | Client-side routing |
| `axios` | ^1.7.2 | MIT | HTTP client |
| `@tanstack/react-query` | ^5.51.1 | MIT | Server state management and caching |
| `react-hook-form` | ^7.52.1 | MIT | Form state and validation |
| `xlsx` | ^0.18.5 | Apache-2.0* | Client-side Excel import and export |
| `vite` *(dev)* | ^5.3.4 | MIT | Build tool and dev server |
| `@vitejs/plugin-react` *(dev)* | ^4.3.1 | MIT | React fast-refresh plugin for Vite |
| `tailwindcss` *(dev)* | ^3.4.6 | MIT | Utility-first CSS framework |
| `autoprefixer` *(dev)* | ^10.4.19 | MIT | CSS vendor prefix automation |
| `postcss` *(dev)* | ^8.4.39 | MIT | CSS transform pipeline |

**`xlsx` licence note:** version `0.18.5` is published under Apache-2.0 and is safe for commercial use. Versions `0.19.0` and above use a proprietary licence that requires a paid commercial licence. The version is pinned intentionally -- do not upgrade without either purchasing a SheetJS Pro licence or replacing the library. See [SECURITY.md](SECURITY.md) for the associated CVE note.

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
