# BranchWise

BranchWise is an offline-resilient desktop management platform designed for multi-branch retail stores and wholesale operations. It integrates POS report processing, physical inventory reconciliation, cargo & logistics tracking, and an AI-powered business analytics assistant into a single, cohesive workflow.

---

## 🛠️ Tech Stack

### Desktop & Frontend
- **Framework:** Electron + React 18 (TypeScript)
- **Bundler:** Vite
- **Styling:** Tailwind CSS
- **State & Data Fetching:** TanStack Query (React Query)
- **Icons & UI:** Lucide React

### Backend & API
- **Framework:** FastAPI (Python 3.11+)
- **Server:** Uvicorn
- **ORM & Migrations:** SQLAlchemy 2.0, Alembic
- **Database:** SQLite (local development) / PostgreSQL (production)
- **Validation:** Pydantic v2

### AI & Data Engine
- **LLM Integration:** OpenAI / DeepSeek (streaming via Server-Sent Events)
- **Knowledge Retrieval:** Hybrid search (BM25 + Cloudflare Workers AI vector embeddings)
- **Data Cleansing:** Pandas, Pyidaungsu

---

## 🚀 Quick Start

### 1. Backend
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
alembic upgrade head
python scripts/seed_retail_accounts.py
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend
```bash
npm install
npm run dev
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
