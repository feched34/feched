# VoiceCommunity Deployment Rehberi

## Render.com ile Deployment (Önerilen)

### 1. Render.com'da Hesap Oluşturun
- [Render.com](https://render.com)'a gidin ve ücretsiz hesap oluşturun

### 2. Yeni Web Service Oluşturun
- Dashboard'da "New +" butonuna tıklayın
- "Web Service" seçin
- GitHub reponuzu bağlayın

### 3. Konfigürasyon
- **Name**: `voicecommunity` (veya istediğiniz bir isim)
- **Environment**: `Node`
- **Build Command**: `npm ci && npm run build`
- **Start Command**: `npm start`

### 4. Environment Variables Ekleme
Render dashboard'da şu environment variables'ları ekleyin:

```
# Database
DATABASE_URL=your_postgresql_database_url

# LiveKit Configuration
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
LIVEKIT_WS_URL=wss://your-livekit-instance.livekit.cloud

# YouTube API
VITE_YOUTUBE_API_KEY=your_youtube_api_key

# Server Configuration
VITE_SERVER_URL=https://your-app-name.onrender.com
NODE_ENV=production
PORT=10000
```

### 5. Database Kurulumu
Render'da PostgreSQL database oluşturun:
- "New +" → "PostgreSQL"
- Database URL'yi kopyalayın ve DATABASE_URL olarak ayarlayın

### 6. Deploy
- "Create Web Service" butonuna tıklayın
- Build işlemi tamamlanana kadar bekleyin

## Build Scriptleri

Proje şu build scriptlerini kullanır:

```json
{
  "build": "vite build && esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist",
  "build:client": "vite build",
  "build:server": "esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist",
  "start": "NODE_ENV=production node dist/index.js"
}
```

## CORS Konfigürasyonu

Production'da CORS ayarları otomatik olarak yapılır. İzin verilen domain'ler:

- `https://your-app-name.onrender.com`
- `https://feched.onrender.com`
- `http://localhost:3000`
- `http://localhost:5050`
- `http://localhost:5173`

## Alternatif Platformlar

### Railway.app
- Railway.app'e gidin
- GitHub reponuzu bağlayın
- Environment variables'ları ekleyin
- Otomatik deploy

### Heroku
- Heroku CLI kurun
- `heroku create voicecommunity-app`
- Environment variables'ları ekleyin
- `git push heroku main`

### Vercel
- Vercel'e gidin
- GitHub reponuzu bağlayın
- Build settings'i ayarlayın

## Önemli Notlar

1. **Database**: Production'da gerçek bir PostgreSQL database kullanın
2. **LiveKit**: LiveKit cloud servisini kullanın
3. **YouTube API**: YouTube API key'inizi güvenli tutun
4. **HTTPS**: Tüm production deployment'ları HTTPS kullanmalı
5. **Environment Variables**: Hassas bilgileri environment variables olarak saklayın
6. **Vite**: Vite artık dependencies'de, build sorunları çözüldü
7. **CORS**: Production'da doğru domain'leri ayarlayın

## Test Etme

Deployment tamamlandıktan sonra:
1. WebSocket bağlantılarını test edin (`/ws` endpoint)
2. Voice chat'i test edin
3. Müzik çaları test edin
4. Chat özelliğini test edin
5. API endpoint'lerini test edin (`/api/ping`)

## Sorun Giderme

### Build Sorunları
- **"vite: not found"**: Vite artık dependencies'de, sorun çözüldü
- **Build timeout**: `npm ci` kullanarak daha hızlı kurulum
- **Memory issues**: Node.js 18+ kullanın

### Database Bağlantısı
- DATABASE_URL'nin doğru olduğundan emin olun
- SSL sertifikası gerekebilir
- Connection pool ayarlarını kontrol edin

### LiveKit Sorunları
- LiveKit credentials'larını kontrol edin
- WebSocket URL'inin doğru formatta olduğunu kontrol edin
- API key ve secret'ların doğru olduğundan emin olun

### CORS Sorunları
- Production URL'inizi `VITE_SERVER_URL` olarak ayarlayın
- Domain'inizin izin verilen listede olduğundan emin olun
- Browser console'da CORS hatalarını kontrol edin

### Port Sorunları
- Render otomatik olarak PORT environment variable'ını ayarlar
- Local'de 5050, production'da 10000 kullanılır 