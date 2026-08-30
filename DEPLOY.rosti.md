# Nasazení Strapi na Roští.cz (Docker Stack)

Tenhle repo je připravený jako **Docker Stack** na [Roští.cz](https://rosti.cz/) —
Strapi 5 + PostgreSQL 16 v jednom `docker-compose.yml`. HTTPS, doménu a zálohy
řeší Roští; my dodáme jen image a `.env`.

**Doporučený tarif:** Docker Stack **Medium** (2 vCPU / 4 GB RAM / 25 GB NVMe,
~238 Kč/měs). Strapi je paměťově náročný — Small (2 GB) je pod hranicí komfortu.

Soubory v repu:
- `Dockerfile` — produkční image Strapi (multi-stage, linux/amd64)
- `docker-compose.yml` — stack ve tvaru, který Roští čeká
- `.env.production.example` — šablona produkčních proměnných
- `.dockerignore`

---

## 1. Založit stack a doménu

1. V Roští založ **Docker Stack** (tarif Medium), 30 dní zdarma bez karty.
2. V záložce **Proxy** nastav doménu stacku (nebo použij přidělenou
   `strapi-xxxx.rostiapp.cz`). HTTPS certifikát se vystaví a obnovuje sám.

## 2. Vygenerovat produkční `.env`

Zkopíruj `.env.production.example` → `.env` a vyplň. **Všechny secrety vygeneruj
čerstvé** (nikdy nepoužívej lokální dev hodnoty):

```bash
# APP_KEYS (potřeba 2+):
node -e "console.log(Array.from({length:4},()=>require('crypto').randomBytes(16).toString('base64')).join(','))"
# jednotlivé secrety (spusť pro každý):
node -e "console.log(require('crypto').randomBytes(16).toString('base64'))"
```

`PUBLIC_URL` nastav na adresu z kroku 1, `STRAPI_IMAGE` doplníš v kroku 3.

## 3. Postavit a nahrát image

Roští Stacky berou **jen images z registru** (`build:` v compose nefunguje).
Dvě cesty:

**A) rosticli (nejrychlejší start)** — build lokálně, přenos přes SSH:

```bash
# jednou: instalace nástroje dle docs.rosti.cz
# Apple Silicon musí buildit pro amd64:
docker build --platform linux/amd64 -t kpz-strapi:latest .
rosticli stacks push        # nahraje image do stacku
```

**B) GitHub Actions → GHCR** — každý push na `main` postaví a uloží image do
GitHub Container Registry, stack ho pak stáhne. Vhodné pro průběžné nasazování.
`STRAPI_IMAGE` pak bude `ghcr.io/<org>/kpz-strapi:latest`.

Do `.env` doplň `STRAPI_IMAGE` = tag, který jsi nahrála.

## 4. Spustit stack

Vlož obsah `docker-compose.yml` do **Compose** editoru stacku a klikni
**Update and run**. Adresáře `./pgsql-data` a `./strapi-uploads` se vytvoří samy
a přežijí každý redeploy.

Ověř `https://<doména>/admin` — mělo by naběhnout založení prvního admina.

## 5. Nalít obsah + média

Lokální instance je už naplněná (seed + 71 MB médií v `public/uploads`).
Nejjednodušší je **přenést hotová data přes Strapi Transfer** — přenese schéma,
záznamy i média jedním příkazem přes HTTPS:

1. V produkčním adminu → **Settings → Transfer Tokens** vytvoř push token.
2. Lokálně (proti běžícímu lokálnímu Strapi):

```bash
pnpm strapi transfer --to https://<doména>/admin --to-token <token>
```

Alternativa (čistý seed na serveru): vyžadovala by na serveru zdrojová aktiva
z `kpz-app/assets/content` a dev závislosti — proto je transfer z lokálu
pohodlnější. Detaily seedu viz `scripts/seed.cjs`.

## 6. Přepnout appku na produkci

V `kpz-app` nastav `EXPO_PUBLIC_STRAPI_URL` na `https://<doména>` a udělej nový
build. Změny obsahu se pak k uživatelům dostávají samy přes API.

---

## Média a zálohy

- **Média** teď leží na perzistentním disku (`./strapi-uploads`). Až jich bude
  hodně (videa!), dá se Strapi kdykoli přepnout na Cloudflare R2 / S3 přes
  upload plugin — bez zásahu do appky.
- **Postgres** je v `./pgsql-data`; Roští navíc zálohuje. Pro jistotu občas
  `pg_dump` do bezpečí.

## Aktualizace kódu Strapi

Nový build image (krok 3) + Update and run (krok 4). Data v `./pgsql-data`
a `./strapi-uploads` zůstávají nedotčená.
