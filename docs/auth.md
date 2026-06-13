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
- `GET /api/auth/me` → returns `{ configured, required, user }` for the UI.
- `POST /api/auth/logout` → clears the cookie.

The callback redirects the browser to a tailnet URL, so your device must be on
the tailnet. Cookies are scoped to the host, so the web (`:3000`) and
orchestrator (`:4317`) share them.

## Access gating and roles (opt-in)

By default sign-in only surfaces identity — the tailnet is the access boundary.
You can additionally require sign-in for the API and split access into roles:

```
LUMPY_REQUIRE_AUTH=true              # require a signed-in user for the API
LUMPY_ADMIN_LOGINS=mattnctrl         # comma-separated GitHub logins that are admins
```

- **Gating is opt-in and fail-safe.** It is only enforced when GitHub sign-in is
  also configured; if `LUMPY_REQUIRE_AUTH=true` is set without credentials, the
  orchestrator logs a warning and leaves the API open rather than locking you out.
- `/api/health` and the `/api/auth/*` sign-in flow stay reachable while gated, so
  you can always sign in.
- **Roles:** if `LUMPY_ADMIN_LOGINS` is empty, **everyone who signs in is an
  admin** (so enabling auth can't lock the owner out). When set, listed logins
  are admins (full access) and everyone else is a **viewer** (read-only — `GET`
  allowed, mutations return `403`). Your role shows on the Settings page.

Enable it only after you've confirmed you can sign in successfully.
