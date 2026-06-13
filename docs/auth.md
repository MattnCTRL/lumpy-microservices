# Authentication (Sign in with GitHub)

Lumpy can sign you in with GitHub and mirror your GitHub profile (avatar, name,
handle) in the header. Sign-in is **optional** — the app is already private on the
tailnet — and is disabled until a GitHub OAuth app is configured.

## Create a GitHub OAuth app

1. GitHub → Settings → Developer settings → **OAuth Apps** → **New OAuth App**.
2. Fill in:
   - **Application name:** Lumpy
   - **Homepage URL:** `http://100.81.90.46:3000` (your tailnet web URL)
   - **Authorization callback URL:** `http://100.81.90.46:4317/api/auth/github/callback`
3. Create it, then **generate a client secret**. Note the **Client ID** and
   **Client secret**.

## Configure the orchestrator

Add to `/opt/lumpy/.env` (and restart the orchestrator):

```
LUMPY_GITHUB_CLIENT_ID=<client id>
LUMPY_GITHUB_CLIENT_SECRET=<client secret>
LUMPY_WEB_URL=http://100.81.90.46:3000
LUMPY_AUTH_SECRET=<long random string>   # keeps you signed in across restarts
```

Reload the UI — a **Sign in with GitHub** button appears in the header. After
signing in, your avatar and name show there; click it to sign out.

## How it works

- `GET /api/auth/github/login` → redirects to GitHub with a signed `state`.
- `GET /api/auth/github/callback` → verifies state, exchanges the code for a
  token, fetches the GitHub profile, and stores it in a signed, http-only cookie.
- `GET /api/auth/me` → returns `{ configured, user }` for the UI.
- `POST /api/auth/logout` → clears the cookie.

The callback redirects the browser to a tailnet URL, so your device must be on
the tailnet. Cookies are scoped to the host, so the web (`:3000`) and
orchestrator (`:4317`) share them.

## Notes

- Sign-in currently surfaces identity; it does not yet gate access (the tailnet
  does). Role-based gating is a future enhancement.
