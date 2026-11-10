# 🐝 Bee Spelling

**Bee Spelling** is a tactile, Duolingo-inspired, zero-login vocabulary, Part-of-Speech, and spelling trainer built as a zero-build static web app (`index.html`) paired with a lightweight Google Apps Script cloud sync bridge (`drive-sync-bridge.gs`).

It runs directly from your computer (`file://` or `localhost`) or on any static host (GitHub Pages, Vercel, Netlify), works offline-first on iPhone/iPad Safari and desktop browsers, and syncs all units, 3-strike mastery recovery, streaks, AI Coach reports, and complete backups directly into your Google Drive folder.

---

## 1. File Overview

```text
bee-spelling/
├── index.html              # Complete single-file application (inline CSS + JS, zero hardcoded secrets)
├── drive-sync-bridge.gs    # Companion Google Apps Script Web App for zero-login direct Google Drive folder sync
├── config.local.js         # Git-ignored local-only configuration (API key, Drive folder URL, Bridge URL)
├── .gitignore              # Prevents config.local.js and .env files from ever being committed
└── README.md               # Setup, deployment, workflow, security notes, and troubleshooting guide
```

When cloud sync is connected, `drive-sync-bridge.gs` automatically maintains structured JSON files directly inside your configured Google Drive root folder:

```text
<Google Drive Root Folder>/
  ├── units/
  │   ├── units_index.json          # Metadata index + deletion tombstones for multi-device sync
  │   └── unit_<unitId>.json        # Vocabulary unit words, meanings, POS, distractors, and images
  ├── progress/
  │   └── user_progress.json        # Per-word mastery, 3-strike recovery counters, XP, streak, bookmark
  ├── analytics/
  │   ├── mistake_history.json      # Misspellings, POS confusions, and response times
  │   └── gemini_reports.json       # Saved AI Coach insights reports
  ├── config/
  │   └── app_settings.json         # Synced user preferences (sound mute, voice engine, theme)
  └── backup/
      └── user_data_backup.json     # Complete standalone JSON snapshot of all user data
```

---

## 2. Deploying `drive-sync-bridge.gs` (Step-by-Step)

Static browser pages cannot write to Google Drive without an OAuth consent screen or backend relay. Deploying `drive-sync-bridge.gs` as a free Google Apps Script Web App gives you automated, zero-login direct Drive sync in about 60 seconds:

1. **Confirm your Google Drive Root Folder ID:**
   - In `drive-sync-bridge.gs`, `const ROOT_FOLDER_ID` is pre-configured with your target folder ID.
2. **Create the Apps Script Project:**
   - Go to https://script.google.com and click **New project**.
   - Rename the project to **`Bee Spelling Sync Bridge`**.
   - Delete any starter code in `Code.gs`, paste the **entire contents** of `drive-sync-bridge.gs`, and press **Save** (`Cmd+S` / `Ctrl+S`).
3. **Deploy as a Web App:**
   - Click **Deploy → New deployment** (top right).
   - Click the gear icon next to **Select type** and choose **Web app**.
   - Configure the deployment settings **exactly** as follows:
     - **Description:** `Bee Spelling Bridge v1`
     - **Execute as:** **`Me`** (your Google account)
     - **Who has access:** **`Anyone`** *(Required so browser simple CORS POST requests can write files to your Drive folder without login redirects.)*
   - Click **Deploy**.
4. **Authorize Drive Access:**
   - Click **Authorize access**, choose your Google account, click **Advanced → Go to Bee Spelling Sync Bridge (unsafe)** (standard prompt for personal unverified Apps Scripts), and click **Allow**.
5. **Copy the Web App URL:**
   - Copy the resulting **Web app URL** ending in `/exec`:
     `https://script.google.com/macros/s/.../exec`
   - Paste it into `config.local.js` as `DRIVE_SYNC_WEBAPP_URL` or paste it directly in the in-app **Vault** (`🔑`) and click **Test & Upload All Data**. All user data immediately uploads to Google Drive!

> **Updating the script later:** Whenever you edit `drive-sync-bridge.gs`, click **Deploy → Manage deployments → Pencil (Edit) → Version: New version → Deploy** so your `/exec` URL stays identical.

---

## 3. Configuring the Web App URL & Gemini Key

Bee Spelling resolves configuration at runtime in this priority order:
1. **In-App Key & Sync Vault** (saved in that browser's `localStorage`)
2. **`config.local.js`** (local git-ignored file in the same folder as `index.html`)
3. **Empty / Local Mode** (app works 100% offline with built-in Web Speech TTS and rule-based AI Coach insights)

### Option A: `config.local.js` (Fastest for Local Use)
Edit `config.local.js` (which is already listed in `.gitignore`):

```js
window.BEE_LOCAL_CONFIG = {
  GEMINI_API_KEY: "<YOUR_GEMINI_API_KEY>",
  DRIVE_FOLDER_URL: "https://drive.google.com/drive/folders/<YOUR_FOLDER_ID>",
  DRIVE_SYNC_WEBAPP_URL: "https://script.google.com/macros/s/<YOUR_DEPLOYMENT_ID>/exec",
  GEMINI_TEXT_MODEL: "", // Optional model override
  GEMINI_TTS_MODEL: ""   // Optional TTS model override
};
```

### Option B: In-App Key & Cloud Sync Vault (Best for Hosted Sites, Phones & iPads)
1. Open Bee Spelling and click the **🔑 Vault** button (top HUD or Login screen).
2. Paste your **Apps Script Web App URL** (`/exec`), **Google Drive Folder URL**, and optional **Gemini API Key**.
3. Click **Test Drive Sync** and **Test Gemini Key** to verify connectivity with live status feedback.
4. Click **Save Vault Settings**.

---

## 4. Running Locally

No `npm install`, bundler, or build step is required.

- **Direct `file://` Launch:** Double-click `index.html` in Finder / File Explorer to open it directly in Safari, Chrome, Edge, or Firefox.
- **Local HTTP Server (Recommended for full Clipboard & History API parity):**
  ```bash
  cd bee-spelling
  python3 -m http.server 8080
  ```
  Then open http://localhost:8080 in your browser.

---

## 5. Hosting on GitHub Pages, Vercel, or Netlify

Because `config.local.js` is ignored by `.gitignore`, **only safe, public files (`index.html`, `drive-sync-bridge.gs`, `.gitignore`, `README.md`) are committed to Git**. On a hosted URL, the browser will gracefully ignore the missing `config.local.js` and start cleanly.

1. Push the repository to GitHub and enable **GitHub Pages** (or connect the repo to **Vercel** / **Netlify** with Build Command = *None* and Output Directory = `.`).
2. Open your hosted URL on your primary computer, open **🔑 Vault**, paste your **Apps Script Web App URL** (and optional Gemini API key), and save.
3. **Onboarding Phones, Tablets & Friends in One Tap:**
   - Inside **🔑 Vault**, click **🔗 Copy Setup Link**.
   - This generates a URL with a `#setup=...` fragment containing **only** the Apps Script Bridge URL and Drive Folder URL (**never** your Gemini API key or password).
   - Send that Setup Link to your iPhone, iPad, or a friend. When opened, Bee Spelling imports the bridge URL automatically and cleans `#setup=...` out of the address bar via `history.replaceState`.

---

## 6. Creating Your First Account & Sharing Units with Friends

### Creating Your First Account
1. Open Bee Spelling. Once the Apps Script Bridge URL is configured, you will see the **Log In / Sign Up** card. *(Without a bridge URL, you can also click **Use Local Mode** at any time to study offline on that device.)*
2. Switch to the **Sign Up** tab, pick a username (`3–24` characters: lowercase letters `a–z`, digits `0–9`, `_`, or `-`), and enter a password (`4+` characters).
3. Submitting creates `<username>/password.txt` (salted + hashed) and all required subfolders in Google Drive, seeds your account with the 12-word **🐝 Starter Demo Unit**, and keeps you signed in across reloads.

### Adding Friends & Importing Shared Units
1. Share your hosted app link (or **Copy Setup Link** from the Vault) with a friend.
2. Your friend switches to **Sign Up** and creates their own username and password. Their progress, mistakes, and streaks live in their own `<friend_username>/` Drive folder and never mix with yours.
3. To copy a vocabulary unit a friend created:
   - On the **Units Hub**, click **🤝 Import from Friend**.
   - Enter your friend's exact username and click **Find Units**.
   - Click **Import Copy** next to any unit. You receive an independent copy of the words with fresh `0%` mastery so you can practice at your own pace.

---

## 7. Gemini Vocabulary Extractor Workflow

Bee Spelling gives you two ways to turn textbook pages, worksheets, or study notes into interactive 3D flashcard & spelling units:

### Workflow 1: Copy Prompt for `gemini.google.com` (Zero API Quota Needed)
1. Click **+ Create New Unit** on the Units Hub.
2. On Tab 1 (**✨ Copy Prompt & Paste JSON**), click **📋 Copy Prompt for Gemini Website**.
3. Open https://gemini.google.com, upload photos/screenshots of your worksheet or word list, paste the prompt, and send.
4. Copy Gemini's JSON response (fenced ```` ```json ```` blocks or surrounding commentary are stripped automatically) and paste it into Bee Spelling — or drag-and-drop a `.json` file.
5. Click **🔍 Preview & Sanitize Words**, optionally tweak any definition, POS, distractor, or image in the **✏️ Visual Word Editor** tab, and click **💾 Save Vocabulary Unit**.

### Workflow 2: Direct Auto-Extract via Gemini API Key
1. Open **+ Create New Unit** and select Tab 2 (**📷 Auto-Extract via Key**).
2. Attach one or more worksheet/textbook photos and/or type raw word notes.
3. Click **✨ Extract Vocabulary with Gemini** — Bee Spelling calls the Gemini API directly with structured JSON output, populates the Visual Word Editor for review, and lets you save in one click.

---

## 8. Security Notes (Please Read)

Bee Spelling is intentionally designed as a **zero-server static app + personal Google Drive bridge** for students, families, and study groups. Keep these trade-offs in mind:

- **Friends-and-Family Gate, Not Bank-Grade Auth:** Authentication is enforced by your Google Apps Script Web App rather than a dedicated identity provider. Use unique, non-sensitive passwords that you do not reuse on banking or email accounts.
- **Keep Your Bridge Web App URL Private:** Because Apps Script Web Apps require `Who has access: Anyone` to accept browser `fetch` calls without CORS preflight failures, anyone who knows your `/exec` URL can send requests to your bridge (such as creating an account or looking up friend units by username). Share Setup Links only with people you trust.
- **Salted & Iterated Password Hashing:** Plaintext passwords are never written to Google Drive or `localStorage`. `password.txt` stores `bee1$<16-byte-hex-salt>$<2500-round-sha256-hex>`, verified in constant time with a 5-attempt / 5-minute rate-limit lockout, and `auth/sessions.json` stores only SHA-256 hashes of session tokens.
- **Restrict Google Drive Folder Sharing:** Because `drive-sync-bridge.gs` runs with `Execute as: Me`, **you do NOT need to make your Google Drive folder public**. Keep the Drive folder itself private (or restricted to trusted viewers) so external visitors cannot browse `password.txt` or user JSON files directly in Google Drive.
- **Protect Your Gemini API Key:** Any key stored in `config.local.js` is plaintext on that local computer, and any key saved in the in-app Vault is stored in that browser's `localStorage`. **Never commit `config.local.js` to Git**, and **rotate/revoke any API key immediately** in Google AI Studio / Google Cloud Console if it has ever been pasted into a public repo, screenshot, or chat.

---

## 9. Troubleshooting & Keyboard Shortcuts

### Troubleshooting

- **CORS or Redirect Error when testing Drive Sync:**
  - Verify you copied the Web App URL ending in **`/exec`** (not `/dev`, which requires an active Google Script editor login).
  - In Apps Script **Deploy → Manage deployments**, confirm **Execute as** is **`Me`** and **Who has access** is **`Anyone`**.
  - If you edited `drive-sync-bridge.gs`, deploy a **New version** and ensure Drive permissions were authorized.
- **`"unauthorized"` or Logged Out Unexpectedly:**
  - Each account keeps up to 10 active device tokens in `auth/sessions.json`. Signing in on an 11th session evicts the oldest token. Simply sign back in — any unsynced local study progress is preserved and merged on reconnect.
- **Gemini `"model not found"` (`404`) or Permission Error (`403`):**
  - Bee Spelling automatically steps through its built-in fallback model chains and auto-routes between Google AI Studio and Vertex AI Express endpoints. If Google retires older preview IDs in the future, open **🔑 Vault → Advanced Model Overrides** (or `config.local.js`) and enter a current model ID from https://ai.google.dev/gemini-api/docs/models.
- **TTS Voice Is Silent on iPhone or iPad Safari:**
  - Flip the physical **Ring / Silent switch** on the side of your iPhone (or Control Center bell icon on iPad) — iOS WebKit mutes Web Audio when hardware silent mode is active.
  - Tap any button once to unlock iOS audio, verify the HUD speaker toggle shows **`🔊`**, or switch **Voice Engine** in **🔑 Vault** between **Gemini `"Kore"`** and **Device Web Speech**.
- **Sync Pill Stuck on `"Syncing..."` or `"Offline — saved locally"`:**
  - Click the sync pill in the top HUD to inspect the last sync timestamp and pending queue count, then click **🔄 Force Sync Now**.
  - Confirm `ROOT_FOLDER_ID` in `drive-sync-bridge.gs` matches your Google Drive folder and that the folder has not been moved to Google Drive Trash.

### Desktop Keyboard Shortcuts

| Context | Shortcut | Action |
| :--- | :--- | :--- |
| **Memories Mode** | `Space` | Flip 3D flashcard front/back |
| **Memories Mode** | `←` / `→` | Previous / Next vocabulary card |
| **Quiz & Mini-Quiz** | `1` – `4` | Select multiple-choice spelling option 1–4 |
| **Quiz & Mini-Quiz** | `Q` / `W` / `E` / `R` | Select Part-of-Speech pill 1–4 |
| **Quiz & Mini-Quiz** | `Enter` | Check answer (when both parts are filled) or advance to Next |
| **Anywhere** | `Escape` | Close active modal/drawer or return to previous screen |
