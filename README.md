# Televisorium Sync · Dizipal (userscript)

Tek dosyalık bir userscript: dizipal* üzerinde izlediklerinizi **doğrudan** Nextcloud'unuzdaki
**Televisorium** uygulamasına senkronlar. Ek sunucu yok — tarayıcıdaki userscript, verdiğiniz
Nextcloud OCS API'si ile konuşur. Bu sayede tüm cihazlarınızda aynı kütüphane, izleme durumu, devam
kaydı ve puanlar paylaşılır.

Dosya: `dizipal-televisorium.user.js`

---

## Özellikler

- **Çalma takibi (saniye seviyesi)** — Playerjs / HTML5 sunucularda `watched_seconds` senkronlanır;
  bittiğinde `watched`, çalarken `watching` durumuna geçer. `runtime` aşılırsa backend otomatik `watched` yapar.
- **Bölüm seviyesi** — Dizi bölüm sayfalarında sezon/bölüm otomatik algılanır; bölüm izleme durumu
  `<item>/episodes` (upsert) ile kaydedilir. Dizi durumu backend tarafından bölümlerden türetilir.
- **İzleme listesi** — Sayfa üzerindeki "İzleme Listesi" butonu ile `status: watchlist` eklenir, tekrar
  tıklanınca öğe kütüphaneden kaldırılır (DELETE).
- **Puanlama** — 0–10 puan verir (`rating`).
- **Durum yönetimi** — watchlist / izleniyor / izlendi / beklemede / bırakıldı.
- **Devam kaydı (çapraz cihaz)** — Oynatma başladığında, backend'de saklanan `watched_seconds`
  varsa video o konuma atlanır.
- **Ekstra sayfa** — Sağ alttaki senkron "rozet"e dokununca **Ayarlar** ve **Sync Durumu** panelleri açılır
  (geçmiş senkron günlüğü dahil). Ayrıca Tampermonkey menü kısayolları: "Ayarlar" ve "Durum".

## Kurulum

1. **Nextcloud** tarafında (tercihen) bir **uygulama parolası** oluşturun:
   `Ayarlar → Güvenlik → Uygulama parolaları → Yeni uygulama parolası`.
   (Normal şifre de çalışır, ancak uygulama parolası önerilir.)

2. **Masaüstü (Tampermonkey / Violentmonkey / Firemonkey):**
   - Eklentiyi kurun, `dizipal-televisorium.user.js` dosyasını eklentiye sürükleyip kurun, ya da
     dosyayı açıp "Install" deyin.
   - dizipal sitesinde herhangi bir sayfaya gidin.

3. **iOS (Userscripts uygulaması):**
   - App Store'dan "Userscripts" uygulamasını kurun, Safari uzantısını etkinleştirin.
   - Userscripts'e aynı `.user.js` dosyasını ekleyin (`@match` zaten `dizipal*` içindir).

4. **Yapılandırma:**
   - Sağ alttaki rozete tıklayın → **Ayarlar**.
   - Nextcloud adresinizi (örn. `https://nextcloud.example.com/nextcloud` veya alt klasör dahil),
     kullanıcı adını ve parolayı girin → **Kaydet & Test Et**.
   - "Bağlantı OK · Televisorium yüklü" mesajı gelirse hazırsınız.

## Kullanım

- Bir film/dizi sayfasında **İzleme Listesi**, **İzledim**, **Puan** ve **Durum** butonları görünür.
- Videoyu oynatın; konum otomatik kaydedilir. Bitince otomatik olarak "izlendi" işaretlenir.
- Diğer cihazda aynı bölüme girdiğinizde kaldığınız yerden devam eder.

## Notlar / sınırlamalar

- **iOS + sanal (iframe) sunucular:** Çapraz-orijin iframe içinde oynatıcıya müdahale edilemez.
  Bu durumda yalnızca bölüm seviyesinde "izleniyor" kaydı yapılır; "İzledim" butonuyla bölüm işaretlenir.
  Playerjs/HTML5 sunucularda saniye seviyesinde takip tam çalışır.
- **CORS:** iOS'ta userscript normal `fetch` ile çalışır; Nextcloud sunucunuz CORS'u kısıtlıyorsa
  yazma istekleri engellenebilir. Masaüstünde `GM_xmlhttpRequest` kullanıldığı için kısıtlama yoktur.
  (Bir ara web sunucusuna gerek kalmadan tam çözüm için Nextcloud'da CORS iznine izin verin.)
- **TMDb araması:** Kütüphaneye ekleme, backend'in `/search` (TMDb) ucundan meta ile yapılır.
  TMDb anahtarı yapılandırılmamışsa öğeler yalnızca başlık ile oluşturulur (`tmdb_id` sonradan
  doldurulmaz).

## Veri / güvenlik

- Parola, yalnızca userscript'in kapalı kutusunda (GM değeri / localStorage) saklanır ve her istekte
  `Authorization: Basic` olarak Nextcloud'unuza gider. Başka hiçbir yere gönderilmez.
- Kullanılan uçlar (Televisorium OCS):
  `GET /items`, `POST /items`, `PUT /items/{id}`, `DELETE /items/{id}`,
  `GET /items/{id}/episodes`, `POST /items/{id}/episodes`, `GET /search?query=`, `GET /settings`.