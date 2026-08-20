# Instagram Automation Manager

v1.0.0 — Electron + React + TypeScript masaüstü paneli. Takip kuyruklarını, listeleri ve otomasyonu **resmi Instagram/Meta API sınırları içinde** yönetir.

Uygulama Instagram şifresi istemez, scraping yapmaz ve API’nin desteklemediği takip/takipten çıkarma işlemlerini başarılıymış gibi göstermez.

## Teknolojiler

Electron, React, TypeScript, Vite, SQLite (sql.js), Vitest.

## Kurulum (development)

```bash
npm install
npm run dev
```

Diğer komutlar:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:win
npm run clean
```

Dashboard uygulama açıldığında yüklenir. Veritabanı Windows’ta `app.getPath('userData')` altında tutulur.

## Production / Windows installer

```bash
npm run build:win
```

Çıktı klasörü: `dist/`

- `Instagram-Automation-Manager-Setup.exe` — NSIS kurulum (masaüstü ve Start Menu kısayolu, klasör seçimi, kaldırıcı)
- `Instagram-Automation-Manager-Portable.exe` — taşınabilir sürüm

Hedef: Windows x64.

İkon: `assets/icon.png` (placeholder). Gerçek logoyu bu dosyanın yerine 256×256 PNG olarak koyun; Windows için isteğe bağlı `assets/icon.ico` da eklenebilir.

## Mock mode

Uygulama varsayılan olarak **official** provider kullanır ve ilk açılışta hiçbir hesap bağlı değildir. Demo hesap oluşturulmaz.

Birim testleri `MockInstagramService` kullanabilir. Geliştiricide mock yalnızca şu durumda açılır:

```env
INSTAGRAM_PROVIDER=mock
```

Bu ayar production arayüzünde sahte “Bağlı” hesap göstermez. **Instagram Hesabı Bağla** resmi OAuth akışını başlatır (`META_APP_ID` gerekir).

## Environment variables

`.env.example`:

```env
INSTAGRAM_PROVIDER=official
META_APP_ID=
META_APP_SECRET=
INSTAGRAM_REDIRECT_URI=
INSTAGRAM_TUNNEL_ORIGIN=
OAUTH_CALLBACK_PORT=8734
```

- `META_APP_ID` / `META_APP_SECRET`: Instagram Business Login ekranındaki **Instagram App ID** ve **Instagram App Secret** (dashboard üstündeki Meta App ID değil).
- `INSTAGRAM_REDIRECT_URI`: Meta’ya kaydettiğin tam HTTPS callback. Kodda hard-code edilmez.
- `INSTAGRAM_TUNNEL_ORIGIN`: `INSTAGRAM_REDIRECT_URI` boşsa uygulama `{origin}/auth/instagram/callback` üretir.
- `OAUTH_CALLBACK_PORT`: Tunnel’ın yönlendirdiği yerel dinleyici. **Bu adres Meta paneline yazılmaz.**

`.env` ve `.env.local` git’e gönderilmez. Production’da aynı değişkenleri `%APPDATA%\Instagram Automation Manager\.env` dosyasına koyabilirsiniz.

Access token SQLite’a yazılmaz; Electron `safeStorage` (Windows DPAPI) ile şifrelenir.

## Meta Developer / OAuth (Instagram Business Login)

HTTP loopback (`http://127.0.0.1:...`) ve `https://localhost:...` kabul edilmez.

1. Meta for Developers → uygulama → **Instagram API → API setup with Instagram login → Set up Instagram business login → Business login settings**.
2. **Instagram App ID** ve **Instagram App Secret** değerlerini `.env` içine `META_APP_ID` / `META_APP_SECRET` olarak yazın.
3. **OAuth redirect URIs** alanına, `.env` içindeki `INSTAGRAM_REDIRECT_URI` ile **birebir aynı** HTTPS adresi girin. Yol: `/auth/instagram/callback`.
4. İzinler: `instagram_business_basic`, `instagram_business_manage_comments`.
5. Uygulamayı yeniden başlatın ve **Instagram Hesabı Bağla** deyin.

Kendi HTTPS domainin varsa:

```env
INSTAGRAM_REDIRECT_URI=https://SENIN-DOMAININ/auth/instagram/callback
```

Domain yoksa aşağıdaki Cloudflare Tunnel adımlarını kullanın. Meta paneline otomatik yazılmaz; oluşan HTTPS URL’yi hem `.env` hem Meta’ya sen eklemen gerekir.

### Windows: Cloudflare Tunnel (geliştirme)

Yerel sunucu `http://127.0.0.1:8734` dinler. Meta yalnızca tünelin HTTPS adresini görür.

```powershell
winget install --id Cloudflare.cloudflared -e
cloudflared tunnel --url http://127.0.0.1:8734
```

Çıktıdaki adresi kopyala (örnek biçim: `https://random-words.trycloudflare.com`). Sonra `.env`:

```env
INSTAGRAM_TUNNEL_ORIGIN=https://random-words.trycloudflare.com
# veya doğrudan:
INSTAGRAM_REDIRECT_URI=https://random-words.trycloudflare.com/auth/instagram/callback
OAUTH_CALLBACK_PORT=8734
```

Meta → Business login settings → OAuth redirect URIs:

`https://<cloudflared-hostname>/auth/instagram/callback`

Quick tunnel hostname her başlatışta değişebilir; değişirse hem `.env` hem Meta kaydını güncelle. Kalıcı hostname için Cloudflare named tunnel + kendi domainin gerekir.

`official` seçili ama `META_APP_ID` veya geçerli HTTPS redirect yoksa uygulama çökmez; hesap **Bağlı değil** kalır. Bağla denemesi yapılandırma hatası verir.

## Resmi API’nin gerçekten desteklediği işlemler

Desteklenir (izinler yeterliyse): profil, medya, bağlı hesabın takipçi/takip edilen **sayıları**, kendi medya yorumları.

Desteklenmez: başka hesapları FOLLOW/UNFOLLOW, takipçi veya takip edilen **listesi**. Official modda bu işler `unsupported`/`failed` kaydı alır; sahte SUCCESS üretilmez.

## Database ve yedek

SQLite dosyası userData klasöründedir. Ayarlar’dan yedek alıp geri yükleyebilir veya yerel veriyi iki adımlı onayla sıfırlayabilirsiniz. Güncellemede mevcut veritabanı silinmez; migration’lar uygulanır.

## Güvenlik

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- IPC yalnızca preload
- Parametreli SQL
- CSV formül enjeksiyonu ve boyut limiti
- Secret’lar loglanmaz

## Troubleshooting

- `npm run dev` açılmazsa Electron indirme script’inin çalıştığından emin olun.
- Packaged uygulamada SQLite wasm `extraResources` ile kopyalanır.
- Official FOLLOW denemesi “API izinleriyle desteklenmiyor” gösterir; bu beklenen davranıştır.
