# ReplyPilot — AI Email Assistant for Boxing Gyms

**ReplyPilot** helps boxing gym owners handle email faster. Read your inbox, get AI-drafted replies that follow your gym's rules, and let the system learn your writing style over time.

Built for a gym with 2 locations.

---

## Features

- **Inbox** — Read Gmail threads and send AI-drafted replies in one place. Sync on demand.
- **Reply Rules** — Write your gym's rules once (pricing, hours, policies) and every AI draft follows them exactly.
- **Style Learning** — The system learns your writing style from every reply you send. Drafts improve over time and sound like you, not a generic assistant.
- **Contacts CRM** — Track leads, trial members, full members, and inactive contacts with filterable lists and one-click status updates.
- **Authentication** — Email/password auth powered by Supabase with protected routes.
- **Settings** — Gmail connection, reply rules, and account management.

## Tech Stack

| Category | Technology |
|---|---|
| **Framework** | Next.js 16.2.2 (App Router) |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS 4 with custom design tokens |
| **AI Generation** | Google Gemini `gemini-2.5-flash-lite` |
| **AI Embeddings** | Google Gemini `text-embedding-004` |
| **Authentication** | Supabase Auth |
| **Database** | Supabase (PostgreSQL + pgvector) |
| **Icons** | Lucide React |
| **Deployment** | Vercel |

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier works)
- A [Google AI Studio](https://aistudio.google.com) API key

### Setup

```bash
# Clone the repository
git clone https://github.com/MartinLam12/ReplyPilot.git
cd ReplyPilot

# Install dependencies
npm install

# Configure environment variables
cp .env.local.example .env.local
# Fill in your credentials (see below)

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

### Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
GEMINI_API_KEY=your-gemini-api-key
```

- Supabase credentials: **Project Settings → API** in your Supabase dashboard
- Gemini API key: [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

### Database Setup

Run the SQL files in order in your Supabase SQL Editor:

1. `supabase/schema.sql` — core tables
2. `supabase/style-memory-schema.sql` — style learning tables (requires pgvector, enabled by default on Supabase)

After deploying, backfill your existing sent emails into style memory:

```bash
curl -X POST https://your-app.vercel.app/api/style/backfill \
  -H "Cookie: <your-session-cookie>"
```

Call it repeatedly until the response shows `"remaining": 0`.

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── page.tsx              # Landing page
│   │   ├── dashboard/            # Home dashboard
│   │   ├── inbox/                # Inbox reader + AI reply tool
│   │   ├── contacts/             # Contacts CRM
│   │   ├── api/
│   │   │   ├── ai/generate/      # Gemini reply generation (style-aware)
│   │   │   ├── style/backfill/   # Backfill existing emails into style memory
│   │   │   ├── style/feedback/   # Record style feedback on sent replies
│   │   │   └── gmail/            # Gmail OAuth, sync, send
│   │   ├── actions/              # Server actions (contacts, gym settings, threads, generations)
│   │   ├── login/ signup/        # Supabase auth pages
│   │   ├── settings/             # Gmail connection + reply rules
│   │   ├── about/                # About page
│   │   ├── contact/              # Contact page
│   │   ├── privacy/              # Privacy policy
│   │   ├── terms/                # Terms of service
│   │   └── auth/callback/        # Auth callback handler
│   ├── components/
│   │   ├── ui/                   # Button, Card, Input, Badge, etc.
│   │   └── layout/               # Navbar, Footer
│   └── lib/
│       ├── style-memory.ts       # Style learning: clean, embed, retrieve, profile
│       ├── supabase/             # Supabase client & server helpers
│       ├── user-context.tsx      # Auth context provider
│       ├── types.ts              # TypeScript types
│       └── utils.ts              # Utility functions
├── supabase/
│   ├── schema.sql                # Core DB schema
│   └── style-memory-schema.sql  # Style learning schema (pgvector)
```

## Style Learning

Every reply you send is cleaned, embedded, and stored as a writing sample. The next time you generate a reply, the system:

1. Embeds the incoming email (query vector)
2. Finds your 3 most similar past replies using cosine similarity
3. Injects them into the Gemini prompt as style examples
4. Also injects a computed style profile (tone, avg length, greeting/sign-off patterns)

After sending each reply, a "Sound like you?" prompt appears. Positive feedback boosts that sample's retrieval weight; negative feedback reduces it.

The system never fine-tunes the model — it's retrieval-only, so it works from the first email and scales cheaply.

## Scripts

```bash
npm run dev       # Start dev server
npm run build     # Production build
npm run start     # Start production server
npm run lint      # Run ESLint
```

## License

Private project — all rights reserved.
