# SmartInvest AI - Intelligent Wealth Management

SmartInvest AI is a state-of-the-art, AI-powered stock market intelligence dashboard. It combines real-time data analysis, generative AI insights, and a premium financial user interface to empower investors with institutional-grade intelligence.

## 🚀 Key Features

- **AI-Driven Stock Analysis**: Uses Gemini 3 Flash to provide sentiment analysis, risk assessment, and technical summaries for any ticker symbol.
- **Real-Time Market Grounding**: Leverages Google Search integration to fetch and summarize the latest global financial news.
- **Portfolio Tracking**: Interactive dashboard for managing assets with high-fidelity charts.
- **Secure Authentication**: Robust session management via Firebase, featuring Google Sign-In and mandatory email verification for security.
- **Premium UI/UX**: Designed with a focus on aesthetics and responsiveness using Tailwind CSS and Recharts.

## 🛠️ Technology Stack

- **Framework**: React 19 (ES6 Modules)
- **Styling**: Tailwind CSS
- **Artificial Intelligence**: Google Gemini API (@google/genai)
- **Backend Services**: Firebase 11.3 (Auth & App)
- **Data Visualization**: Recharts
- **Fonts**: Google Fonts (Inter)

## 📦 Setup & Installation

1. **Prerequisites**:
   - A modern web browser with support for ESM and Import Maps.
   - A Google Gemini API Key.

2. **Configuration**:
   - Ensure the `process.env.API_KEY` is accessible in your environment.
   - The Firebase configuration is hardcoded for the current project scope but can be updated in `services/firebase.ts`.

3. **Usage**:
   - Simply open `index.html` to launch the application.

## 🧪 Local testing (no deployed services)

To run everything locally and avoid hitting deployed Supabase or Firebase:

1. Copy the env template: `cp env.local.example .env.local`
2. Set `VITE_LOCAL_TESTING=true` and add your **local** Supabase URL and anon key (from `supabase start`).
3. Run the app with local mode: `npm run dev:local` (or `npm run dev` with `.env.local` present).

When `VITE_LOCAL_TESTING` is true:

- **Supabase**: Only `VITE_SUPABASE_LOCAL_URL` and `VITE_SUPABASE_LOCAL_ANON_KEY` are used; the deployed project is never called.
- **Firebase**: Auth and Firestore use emulators if `VITE_FIREBASE_AUTH_EMULATOR` (and optional Firestore vars) are set; start them with `firebase emulators:start --only auth,firestore`.

Use `.env.local` for local/testing; it is gitignored and overrides `.env`.

## 🛡️ Security

- All authentication flows are handled via Firebase.
- Unverified emails are restricted from accessing the main dashboard to maintain a high-quality user base.
- Built with standard-compliant ESM for secure script loading.

---
Built with ❤️ by [ByAnAI](https://github.com/ByAnAI)
