# JobAgent Pro 🤖

> An AI-powered job application agent that actually remembers you — built for the Hindsight Hackathon.

![JobAgent Pro](https://img.shields.io/badge/Built%20With-Hindsight-blue?style=flat-square) ![Flask](https://img.shields.io/badge/Backend-Flask-black?style=flat-square) ![React](https://img.shields.io/badge/Frontend-React-61DAFB?style=flat-square) ![Hackathon](https://img.shields.io/badge/Hindsight-Hackathon-purple?style=flat-square)

---

## The Problem

Most job platforms are stateless. Every session starts from scratch — your city preference resets, your category is forgotten, and the agent keeps recommending companies you already applied to last week.

JobAgent Pro fixes that with **persistent AI memory** powered by [Hindsight](https://hindsight.vectorize.io/).

---

## What It Does

- **994+ verified job listings** across 20+ Indian cities — real links only, no fake submissions
- **Remembers your preferences** — city, category, job type persist across sessions
- **Tracks your applications** — never surfaces a company you've already applied to
- **Stores your resume & skills** — pre-fills application context automatically
- **Learns over time** — the more you use it, the more personalized it gets

---

## How Hindsight Memory Is Used

Hindsight powers all three memory layers in JobAgent Pro:

### 1. Application Memory
Every time a user applies to a job, we retain the event:
```python
hindsight.retain(
    user_id=current_user.id,
    content=f"Applied to {company} for {role} on {date}",
    metadata={"type": "application", "company": company}
)
```

### 2. Preference Recall
Before surfacing jobs, we recall past applications to filter duplicates:
```python
memories = hindsight.recall(
    user_id=current_user.id,
    query="companies I have already applied to"
)
applied_companies = extract_companies(memories)
jobs = [j for j in all_jobs if j.company not in applied_companies]
```

### 3. Profile Memory
Resume and skills are retained on update and recalled on every application — the agent never asks the user to repeat themselves.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Tailwind CSS |
| Backend | Python / Flask |
| Memory | Hindsight (Vectorize) |
| Database | Supabase |
| Auth | Supabase Auth |
| Deployment | Vercel |

---

## Features

- **Dashboard** — Job Database Controls, filter by city/category, add 500+ jobs instantly
- **Applications** — Track every application with status and history
- **Stats** — Visual analytics of your job search progress
- **Resume** — Upload and store your resume, recalled automatically on apply
- **Skills** — Tag your skills, used by the agent for better matching
- **Career** — Long-term career path recommendations

---

## Getting Started

### Prerequisites
- Node.js 18+
- Python 3.9+
- Supabase account
- Hindsight Cloud account ([get $50 free credits with code MEMHACK315](https://ui.hindsight.vectorize.io))

### Installation

```bash
# Clone the repo
git clone https://github.com/priiyanka-b/careerai.git
cd careerai

# Install frontend dependencies
npm install

# Install backend dependencies
pip install -r requirements.txt

# Set up environment variables
cp .env.example .env
# Fill in your Supabase and Hindsight credentials

# Run the app
npm run dev
```

---

## Environment Variables

Create a `.env` file with the following:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
HINDSIGHT_API_KEY=your_hindsight_api_key
```

---


## Resources

- [Hindsight Documentation](https://hindsight.vectorize.io/)
- [Hindsight GitHub](https://github.com/vectorize-io/hindsight)
- [Agent Memory by Vectorize](https://vectorize.io/features/agent-memory)

---

## License

MIT
