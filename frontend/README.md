# Frontend — Subscription Auditor

React 19 + Vite + TypeScript, Tailwind CSS + shadcn/ui, React Router v6, react-i18next, TanStack Query.

## Setup

```bash
cp .env.example .env.local   # fill in Supabase / API values
npm install
npm run dev                  # http://localhost:5173
```

## Scripts

- `npm run dev` — start the Vite dev server (binds `0.0.0.0:5173` for Docker Compose)
- `npm run build` — type-check (`tsc -b`) then production build
- `npm run lint` — ESLint
- `npm run preview` — preview the production build locally

## Structure

- `src/lib/supabase.ts` — Supabase browser client
- `src/lib/api.ts` — backend API client (`VITE_API_BASE_URL`)
- `src/i18n/` — react-i18next scaffold (`en`, `el`)
- `src/components/ui/` — shadcn/ui components (copy-owned, not a package)
- `src/routes/` — route components
