# BranchWise

**BranchWise** is a desktop management platform built for multi-branch retail and wholesale businesses.

It brings sales reporting, inventory management, logistics tracking, and AI-powered business analytics into one platform, helping businesses monitor operations and make better decisions.

## ✨ Key Features

- **Sales Management** – Process and analyze POS reports across multiple branches.
- **Inventory Management** – Track stock levels and reconcile physical inventory.
- **Logistics Tracking** – Monitor wholesale cargo and delivery progress.
- **AI Business Assistant** – Understand business data and get insights through AI-powered analysis.
- **Multi-Branch Overview** – Monitor business performance across different locations.

## 🛠️ Tech Stack

- **Frontend:** Electron, React, TypeScript, Tailwind CSS
- **Backend:** Python, FastAPI, SQLAlchemy
- **Database:** PostgreSQL
- **AI:** OpenAI, DeepSeek, Hybrid Search
- **Tools:** Vite, TanStack Query, Alembic

## 🚀 Getting Started

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
alembic upgrade head
python scripts/seed_retail_accounts.py
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
npm install
npm run dev
```

## 📄 License

This project is licensed under the [MIT License](LICENSE).
