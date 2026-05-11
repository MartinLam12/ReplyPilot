# ClearPath — AI Email Tools for Boxing Gyms

**ClearPath** helps boxing gym owners save time on email. Get AI-drafted replies to incoming inquiries and send post-class follow-up emails to attendees — all in a few clicks.

🔗 **Live:** [clearpathai-martinlam12s-projects.vercel.app](https://clearpathai-martinlam12s-projects.vercel.app)

Built for a gym with 2 locations.

---

## Features

- **Email Reply Tool** — Paste any incoming email (membership questions, pricing, scheduling) and get an AI-drafted reply in seconds. Edit, then open directly in Gmail.
- **Class Follow-Up Tool** — Log a class, generate a personalised follow-up email, add attendee addresses, and send via Gmail BCC in one click.
- **Contacts CRM** — Track leads, trial members, full members, and inactive contacts with filterable lists and one-click status updates.
- **Gym Settings** — Set your gym name and context once (locations, pricing, schedule) and every AI draft is personalised to your gym.
- **Authentication** — Email/password auth powered by Supabase with protected routes.
- **Settings** — Profile and account management including account deletion.

## Tech Stack

| Category | Technology |
|---|---|
| **Framework** | Next.js 16.2.2 (App Router) |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS 4 with custom design tokens |
| **AI** | Google Gemini (via `@google/generative-ai`) |
| **Authentication** | Supabase Auth |
| **Database** | Supabase (PostgreSQL) |
| **Animation** | Framer Motion |
| **Icons** | Lucide React |
| **Charts** | Recharts |
| **Deployment** | Vercel |

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier works)
- A [Google AI Studio](https://aistudio.google.com) API key

### Setup

```bash
# Clone the repository
git clone https://github.com/MartinLam12/ClearPath.git
cd ClearPath

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

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── page.tsx              # Landing page
│   │   ├── dashboard/            # Home dashboard
│   │   ├── inbox/                # Email reply tool
│   │   ├── classes/              # Class follow-up tool
│   │   ├── contacts/             # Contacts CRM
│   │   ├── api/
│   │   │   ├── draft-reply/      # Gemini route — draft email replies
│   │   │   ├── draft-followup/   # Gemini route — draft class follow-ups
│   │   │   └── ai/
│   │   │       ├── generate/     # Gemini route — general generation
│   │   │       ├── reply/        # Gemini route — reply drafts
│   │   │       └── classify/     # Gemini route — email classification
│   │   ├── actions/              # Server actions (contacts, gym settings, threads)
│   │   ├── login/ signup/        # Supabase auth pages
│   │   ├── settings/             # Account settings
│   │   ├── about/                # About page
│   │   ├── contact/              # Contact page
│   │   ├── privacy/              # Privacy policy
│   │   ├── terms/                # Terms of service
│   │   └── auth/callback/        # Auth callback handler
│   ├── components/
│   │   ├── ui/                   # Button, Card, Input, Badge, etc.
│   │   └── layout/               # Navbar, Footer
│   └── lib/
│       ├── supabase/             # Supabase client & server helpers
│       ├── user-context.tsx      # Auth context provider
│       ├── types.ts              # TypeScript types
│       └── utils.ts              # Utility functions
```

## Scripts

```bash
npm run dev       # Start dev server
npm run build     # Production build
npm run start     # Start production server
npm run lint      # Run ESLint
```

## License

Private project — all rights reserved.
