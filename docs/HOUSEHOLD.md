# Household access and the wall display

How both of you reach the tracker from anywhere, and how a wall display (or a
future hub dashboard) reads its glanceable numbers.

The shape of it: the tracker keeps running on the desktop and has no login of
its own. A Cloudflare Tunnel publishes it on a hostname you own, and Cloudflare
Access decides who gets in — only the Google accounts you list. Two routes
(`/wall` and `/api/wall`) are exempt from that policy because a kiosk browser
cannot complete a Google sign-in unattended; they are guarded by a **display
token** instead. The build assets under `/_next/static` (content-hashed CSS,
JS and the font, carrying no data) are exempt too so the kiosk can render.

Steps 2, 3 and 4 happen in your Cloudflare account and only you can do them.
Steps 1, 5, 6, 7 and 8 are on this machine.

---

## 1. The server

The desktop is the server. Nothing changes about how you start it:

```
npm run app
```

`next start` binds `0.0.0.0`, so the app answers on `http://localhost:3000` and
on `http://<desktop-name>:3000` from the home network. **Closing the launcher
terminal stops the server** — leave the window open (minimised is fine).

So the tunnel is never talking to a sleeping machine, set Windows to keep the
desktop awake:

- Settings → System → Power & battery → Screen and sleep → **Sleep: Never**
  (the screen may still turn off).
- Control Panel → Power Options → Change plan settings → Change advanced power
  settings → Sleep → **Allow hybrid sleep: Off**, **Hibernate after: Never**.
- Device Manager → Network adapters → your adapter → Power Management →
  uncheck **Allow the computer to turn off this device to save power**.

Running the launcher as a scheduled task at logon (so it survives a reboot
without you clicking anything) is a later step; today you start it by hand.

## 2. A domain

Cloudflare needs a domain in your account to attach a hostname to. Any domain
works — a cheap one is fine. Add it to Cloudflare DNS (Add a site → follow the
nameserver instructions at your registrar), then turn on **Zero Trust** from
the dashboard sidebar. The **Free** plan covers up to 50 users; you need two.

Everywhere below, `finance.<domain>` means the hostname you pick, e.g.
`finance.example.com`.

## 3. The tunnel

A tunnel is an outbound-only connection from the desktop to Cloudflare. No
router changes, no port forwarding, no inbound firewall rule.

1. Zero Trust → **Networks** → **Tunnels** → **Create a tunnel** → select
   **Cloudflared** → name it (e.g. `desktop`) → **Save tunnel**.
2. Choose **Windows / 64-bit**. The dashboard prints an install command with
   your tunnel token baked in. Run it in an **Administrator** PowerShell — it
   installs `cloudflared` as a Windows service that starts at boot:

   ```
   cloudflared.exe service install <the long token the dashboard shows>
   ```

   (Cloudflare's snippet also includes the `winget`/MSI download step; take the
   whole thing as printed. The token is a secret — do not paste it anywhere
   else.)
3. Back in the dashboard, wait for the connector to report **Healthy**, then
   **Next**.
4. On **Route tunnel** → **Public Hostname**, add:
   - **Subdomain**: `finance`
   - **Domain**: your domain
   - **Path**: leave empty
   - **Type**: `HTTP`, **URL**: `localhost:3000`

   Save. `https://finance.<domain>` now reaches the app — and, until step 4 is
   done, so does everyone else on the internet. Do step 4 now.

## 4. Access policies (two applications)

First add a login method: in the Cloudflare One dashboard, **Integrations →
Identity providers → Add → One-time PIN** (no configuration; it emails a code
to any address a policy allows). Google can be added there later if you want
tap-to-sign-in; it needs a Google OAuth client id and secret. While you are in
**Settings**, rename the random team name — it becomes the login page address,
`<team>.cloudflareaccess.com`.

Then **Access controls → Applications**. You create **two** self-hosted
applications: one that locks the whole site to your two accounts, and a
narrower one that lets the display routes through. (Older dashboards call these
menus Access → Applications and Settings → Authentication.)

**(a) The tracker — allow the two of you**

- **Add an application** → **Self-hosted**.
- Name: `Finance`. Session duration: **1 month**.
- Public hostname: subdomain `finance`, domain your domain, **path empty**.
- Authentication: identity provider **One-time PIN** (or Google); leave
  "instant authentication" on so a single method skips the chooser.
- Policy: name `Household`, action **Allow**, rule **Include** → selector
  **Emails** → both addresses, lowercase, exactly as the mail provider shows
  them.
- Save.

**(b) The display routes — bypass**

- **Add an application** → **Self-hosted**.
- Name: `Finance wall`.
- Public hostname 1: subdomain `finance`, domain your domain, **path**: `wall`.
- **Add a public hostname** (same application) 2: subdomain `finance`, domain
  your domain, **path**: `api/wall`.
- **Add a public hostname** 3: subdomain `finance`, domain your domain,
  **path**: `_next/static` — the wall's stylesheet, JavaScript chunks and font
  are served from there, and a kiosk with no Access session would get the Google
  sign-in for each one instead (unstyled page, no hydration, so the 5-minute
  refresh never runs). They are content-hashed build assets and carry no data.
  Optionally add a fourth for `favicon.ico`.
  Cloudflare matches the path *and everything under it*, so `wall` also covers
  `wall/enroll` and `_next/static` covers every chunk beneath it.
- Policy: name `Display token`, action **Bypass**, rule **Include** → selector
  **Everyone**.
- Save.

Cloudflare evaluates the more specific application first, so `/wall`,
`/api/wall` and `/_next/static` skip the sign-in prompt while every other path
still requires it. The first two are protected by the display token from
step 5 instead; the build assets need no protection.

**Check it**: open `https://finance.<domain>` in a private window — you should
get Cloudflare's sign-in page. Open `https://finance.<domain>/wall` — you
should get the app's own "This display is not enrolled" page, *not* a sign-in.
Once the display is enrolled the wall should look fully styled and keep
refreshing itself; if it renders as plain unstyled text, the `_next/static`
path is missing from the bypass application.

**The trade-off**: traffic is decrypted at Cloudflare's edge. That is inherent
to a tunnel with Access in front of it. The alternative (a VPN such as
Tailscale) is out of scope here.

## 5. The display

1. In the app: **Settings → Household** → **Generate token**. The token and an
   enrollment link are shown **once**. Copy the enrollment link.
2. On the display device, open that link in the browser you will leave running.
   It sets a long-lived `wall_device` cookie (400 days, httpOnly) and lands on
   `/wall`.
3. Leave the browser on `https://finance.<domain>/wall`, full screen / kiosk
   mode. The page refreshes itself every 5 minutes.

The link shown in Settings uses whatever address you opened Settings on — on
the desktop that is `http://localhost:3000/wall/enroll?token=…`. For a display
somewhere else in the house, swap the host for `finance.<domain>` (or the
desktop's LAN name) and keep the `?token=…` part exactly as it is.

The enrollment URL contains the token itself, so it stays in the display
browser's history until you clear it and may appear in Cloudflare's request
logs. After enrolling, clear the kiosk browser's history (or give the kiosk a
dedicated browser profile), and rotate the token in **Settings → Household** if
the link was ever shared.

**Rotate** issues a new token and invalidates every enrolled display and the
hub; re-enroll them with the new link. **Revoke** invalidates them with no
replacement.

## 6. The hub

A separate dashboard project reads one endpoint, server-side:

```
GET https://finance.<domain>/api/wall
Authorization: Bearer <the display token>
```

- `200` with the JSON below, `Cache-Control: no-store`.
- `401` `{ "ok": false, "error": "Not enrolled." }` when the token is missing or
  wrong.
- Poll every **60–300 seconds**. There is no push and no CORS header: call it
  from the hub's server, not from its browser code.
- Keep the token in the hub's secret store. Rotating in Settings → Household
  breaks the hub until you update it there.

The payload (the `WallSummary` type in `src/lib/wall/types.ts`; integer cents,
dates `YYYY-MM-DD`):

```ts
type WallSummary = {
  generatedAt: string; // ISO time
  today: string; // YYYY-MM-DD
  gateOpen: boolean; // the budget gate: false until 2 complete months of data
  safeToSpend: {
    perDayCents: number;
    totalCents: number;
    untilDate: string; // next payday or month end
    horizonLabel: "until payday" | "until month end";
  } | null;
  bills: {
    due: {
      name: string;
      cents: number;
      expectedDate: string;
      overdue: boolean;
      categoryColor: string | null;
    }[];
    dueTotalCents: number;
  };
  review: { count: number; streakWeeks: number; weeklyDue: boolean };
  budget: {
    month: string;
    spentCents: number;
    budgetedCents: number;
    elapsedShare: number;
  } | null;
  nextPlanned: { name: string; cents: number; date: string } | null;
  alerts: { count: number };
};
```

`safeToSpend` and `budget` are `null` while the budget gate is closed or the
month has no budget; `gateOpen` tells the two apart, so a display can say
"unlocks after 2 months of data" rather than "no budget this month". Every number comes from the same loaders the app's own
Home, Budget, Bills and weekly review screens use, so the wall can never
disagree with the app. No transactions, balances or account names are exposed;
bill `name`s are merchant names.

## 7. Backups

Nightly, on the desktop:

1. Open **Task Scheduler** → **Create Task**.
   - General: name `Finance backup`, **Run whether user is logged on or not**
     off (simplest), **Run with highest privileges** not needed.
   - Triggers: **Daily**, e.g. 02:30.
   - Actions: **Start a program**
     - Program: `powershell.exe`
     - Arguments:
       `-NoProfile -WindowStyle Hidden -Command "cd 'C:\Users\<you>\Projects\Personal Finance Tracker'; npm run backup"`
   - Conditions: uncheck **Start the task only if the computer is on AC power**
     if this is a laptop.
2. Add a second action (or a second task) that mirrors the backup folder into a
   cloud-synced folder:

   ```
   robocopy data\backups "<your OneDrive/Dropbox folder>\finance-backups" /MIR
   ```

**Never put `data\finance.db` itself in a synced folder.** SQLite keeps
`-wal` and `-shm` sidecar files open while the app runs; a sync client copying
them mid-write produces a corrupt database. Sync the backup *copies* only.

Restoring: stop the app, replace `data\finance.db` with a backup, delete any
leftover `data\finance.db-wal` / `-shm`, start the app.

## 8. LAN and localhost

The launcher's own window and anything on the home Wi-Fi can reach
`http://<desktop-name>:3000` directly, with **no Cloudflare and no login**.
That is the accepted exposure of this design: whoever is on your Wi-Fi can open
the tracker.

You do not need a firewall rule for the tunnel (it is outbound only). You need
one only if you *want* LAN access without the tunnel and Windows is blocking
it — in an Administrator PowerShell:

```
New-NetFirewallRule -DisplayName "Finance tracker (LAN)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Profile Private -Action Allow
```

`-Profile Private` keeps it to networks you have marked private. Do not open
port 3000 on your router: the tunnel is the way in from outside.
