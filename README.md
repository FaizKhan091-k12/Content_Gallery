# Game Portal

A private website for the team's WebGL games and interactives, organised like the books:
**Subject → Grade → Unit → Lesson** (seeded from the "K12 Content Upload Status" sheet: Maths, Science, Hindi).
Only people with a login can see anything; only admins can upload, invite people and change settings.
No third-party packages: plain Node.js (18+).

---

## Put it online (free, no card): Render + Backblaze B2

Render's free plan has no permanent disk, so games, cover images and accounts are kept in a
Backblaze B2 bucket (10 GB free, no credit card). The server keeps a copy of each game file on its own disk
after the first download, so B2's free download allowance goes a long way. The site sleeps after 15 minutes
without visitors; the first visit after that takes about a minute to wake up.

### 1. Backblaze B2 (storage)
1. Sign up at backblaze.com → **B2 Cloud Storage** (free, no card).
2. **Buckets** → **Create a Bucket** → a unique name (e.g. `k12-game-portal-<something>`), files **Private** → Create.
   Note the bucket's **Endpoint** (`s3.<region>.backblazeb2.com`).
3. On the bucket → **Lifecycle Settings** → **Keep only the last version of the file** (otherwise every old
   copy of replaced files keeps using your 10 GB).
4. **Application Keys** → **Add a New Application Key** → access to **this bucket only**, **Read and Write** →
   Create. Copy the **keyID** and **applicationKey** (shown once).

### 2. GitHub (where Render reads the code from)
Put this folder in a GitHub repository (`data/` and `storage/` are ignored and never uploaded).

### 3. Render (the website)
1. Sign in at dashboard.render.com → **New** → **Blueprint** → pick the repository (or paste its URL if public).
   Render reads `render.yaml` and creates the free web service **game-portal** (Singapore region).
2. When it asks for the values, enter `S3_ENDPOINT` (the bucket's Endpoint), `S3_BUCKET`,
   `S3_ACCESS_KEY_ID` (keyID) and `S3_SECRET_ACCESS_KEY` (applicationKey).
3. Deploy. When it is live, open the service → **Environment** → copy the generated **SETUP_CODE**.
4. Open `https://<your-service>.onrender.com/setup`, enter the setup code and create **your admin account**.
   The login is fixed to `ADMIN_USERNAME` (faiz.khan@k12onlineschools.com in `render.yaml`), so nobody else can
   claim the portal. After that the setup page closes for good.

Updates: push to GitHub → Render redeploys automatically. Data in the bucket is kept.

Cloudflare R2 works too (it asks for a card): `STORAGE=r2` with `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET` instead of the `S3_*` values.

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
- **Formats:** **Books** are PDFs and open in a page-turning reader (drag a page corner to curl it). **Flashcards,
  2D/3D Interactivities, Simulations, Games and Animations** are Unity WebGL builds.
- **Upload:** Admin panel → Content → *Add a resource*. Pick the format, Subject, Grade and the Lesson from the book
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
| `STORAGE` | `s3` for Backblaze B2 / any S3 service, `r2` for Cloudflare R2; otherwise a local folder (`GP_STORAGE`, default `./storage`) |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | bucket access for `STORAGE=s3` (`S3_REGION` if the endpoint does not name it) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | bucket access for `STORAGE=r2` |
| `GP_CACHE_MB` | disk space for cached game files when using a bucket (default 1024; 0 = off) |
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
