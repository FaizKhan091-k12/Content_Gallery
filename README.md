# Game Portal

A private website for the team's WebGL games and interactives, organised like the books:
**Subject → Grade → Unit → Lesson** (seeded from the "K12 Content Upload Status" sheet: Maths, Science, Hindi).
Only people with a login can see anything; only admins can upload, invite people and change settings.
No third-party packages: plain Node.js (18+).

---

## Put it online (free): Render + Cloudflare R2

Render's free plan has no permanent disk, so games, cover images and accounts are kept in a
Cloudflare R2 bucket (10 GB free). The site sleeps after 15 minutes without visitors; the first visit
after that takes about a minute to wake up.

### 1. Cloudflare R2 (storage)
1. Sign in at dash.cloudflare.com → **R2 Object Storage** → enable R2 (free plan; Cloudflare may ask for a card,
   nothing is charged inside the free limits).
2. **Create bucket** → name it e.g. `game-portal` (leave the default location). Keep it **private** (no public access).
3. R2 overview → **Manage R2 API Tokens** → **Create API token** → permission **Object Read & Write**,
   apply to **this bucket only** → Create. Copy the **Access Key ID** and **Secret Access Key** (shown once).
4. Note your **Account ID** (R2 overview page, right side).

### 2. GitHub (where Render reads the code from)
Put this folder in a **private** GitHub repository (`data/` and `storage/` are ignored and never uploaded).

### 3. Render (the website)
1. Sign in at dashboard.render.com → **New** → **Blueprint** → connect GitHub → pick the repository.
   Render reads `render.yaml` and creates the free web service **game-portal**.
2. When it asks for the values, enter `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
3. Deploy. When it is live, open the service → **Environment** → copy the generated **SETUP_CODE**.
4. Open `https://<your-service>.onrender.com/setup`, enter the setup code and create **your admin account**.
   The login is fixed to `ADMIN_USERNAME` (faiz.khan@k12onlineschools.com in `render.yaml`), so nobody else can
   claim the portal. After that the setup page closes for good.

Updates: push to GitHub → Render redeploys automatically. Data in R2 is kept.

**Forgot the admin password (Render):** add `ADMIN_RESET_USER` = your username and `ADMIN_RESET_PASSWORD` =
a new password in Render → Environment, let it restart, sign in, then **delete both variables**.
(Each reset value is applied only once.)

---

## Run it on a PC instead (or to try things out)
Double-click **`Start Game Portal.bat`** → http://localhost:8642. First time: open http://localhost:8642/setup on that PC.
Files are kept in `storage/` (`storage/data` = accounts & catalogue, `storage/games` = builds). Back up that folder.
Forgot the admin password: close the portal, run `node server/reset-admin.js <username>`.

---

## Using the portal
- **Upload:** Admin panel → Content → *Upload new*. Pick Type, Subject, Grade and the Lesson from the book
  (the title is suggested from the "UCD_Digital Assets → Games" sheet), then choose the WebGL build **folder**
  (the one with `index.html` and `Build`) or a **.zip** of it. Compressed Unity builds (`.gz`, `.br`, `.unityweb`)
  are fixed automatically - the "WebGL auto fix" tool is not needed. Unity's default page is made to fill the
  window and big files are pre-compressed for fast loading.
  Tip: upload the folder (each file goes separately); a single upload request can be limited to ~100 MB by the host.
- **Replace a build:** Content → *Edit* → choose the new build. Everyone gets the new version immediately.
- **People:** Admin → People → *Add person*: own login (an email or a short username) + password (a strong one is generated to copy and send).
  Limit someone to subjects/grades, reset passwords, sign them out everywhere, disable or remove them.
- **Activity:** who signed in and what they played. **Books:** every lesson and which have content; add lessons
  or new subjects (e.g. English). **Settings:** site name, tagline, how long sign-ins last.

## Settings (environment variables)
| Variable | Meaning |
|---|---|
| `STORAGE` | `r2` to use Cloudflare R2; otherwise a local folder (`GP_STORAGE`, default `./storage`) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | R2 bucket access |
| `SETUP_CODE` | lets the first admin be created from any browser (needed on Render) |
| `ADMIN_USERNAME` | the only login allowed to become the first admin (an email or username) |
| `TRUST_PROXY` | `1` behind a hosting proxy (set automatically on Render) |
| `ADMIN_RESET_USER`, `ADMIN_RESET_PASSWORD` | one-time admin password reset (remove afterwards) |
| `PORT`, `HOST` | where to listen (Render sets `PORT`) |

## Security
- Every page, API call and game file needs a valid login (HttpOnly, SameSite session cookie; Secure on HTTPS).
- Passwords are stored as scrypt hashes; 8 wrong tries lock that account / address for 15 minutes.
- Cross-site requests are blocked; uploads are admin-only and cannot write outside their folder.
- The R2 bucket stays private: browsers never talk to R2, the portal checks the login and streams the files.
