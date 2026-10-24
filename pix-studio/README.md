# Pix Studio

AI product photos for Noqta stores: a clean background in any colour, or a realistic scene.

## Run it

**1. Install** (once)

```bash
npm install -g @noqtaps/cli
winget install Cloudflare.cloudflared      # macOS: brew install cloudflared
```

**2. Set up the project**

```bash
git clone https://github.com/osama-ghazal/noqta.git pix-studio
cd pix-studio
npm install
nqs app login --token nqd_YOUR_TOKEN
cp .env.example .env
```

Fill in `.env` with the values Osama sends you:

```ini
NOQTA_CLIENT_ID=
NOQTA_CLIENT_SECRET=
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
```

**3. Start**

```bash
nqs app dev
```

**4. Open it** in admin.noqta.ps → any product → **التطبيقات** → **تحسين الصور**.

## If something's wrong

- **"Invalid or missing session token"**: your computer's clock is off. Turn on *Set time automatically* and sync.
- **Port 3000 in use**: run `nqs app dev --port 3001`.
- **"This page only works inside the Noqta admin"**: open it from the admin, not the tunnel link.
