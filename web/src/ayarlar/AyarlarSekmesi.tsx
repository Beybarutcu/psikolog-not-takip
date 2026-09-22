import type { Dispatch, SetStateAction } from 'react'
import type { Danisan, DepolamaDurumu, YedekListesi } from '../api'
import { boyutBicimle } from '../danisan/bicim'

/**
 * Ayarlar sekmesinin tükettiği yedekleme durumu — `useYedekleme()`'nin
 * dönüşüyle birebir aynı alanlar. Kanca burada ÇAĞRILMIYOR (bkz. dosya
 * başlığı); yalnızca tipi burada tutulur ki `AnaEkran` ile bu bileşen aynı
 * sözleşmeden sapmasın.
 */
type YedeklemeDurumu = {
  yedek: YedekListesi | null
  uyari: string | null
  klasorFormuAcik: boolean
  setKlasorFormuAcik: Dispatch<SetStateAction<boolean>>
  klasorGirdisi: string
  setKlasorGirdisi: Dispatch<SetStateAction<string>>
  suruyor: boolean
  al: (hedefDizin?: string) => Promise<boolean>
}

/** `useParolaFormu()`'nin dönüşüyle birebir aynı alanlar. */
type ParolaFormu = {
  acik: boolean
  mevcutParola: string
  setMevcutParola: Dispatch<SetStateAction<string>>
  yeniParola: string
  setYeniParola: Dispatch<SetStateAction<string>>
  yeniParolaTekrar: string
  setYeniParolaTekrar: Dispatch<SetStateAction<string>>
  hata: string | null
  bilgi: string | null
  suruyor: boolean
  acKapa: () => void
  degistir: () => Promise<void>
}

/**
 * Saklama süresi dolan dosyalar hatırlatması. Liste `useDanisanListesi()`den
 * geliyor; açma eylemi `AnaEkran`'daki `danisanKartiAc`'ın kendisi (danışan
 * çipiyle ve hızlı aramayla AYNI yol) — burada ayrı bir kopyası yazılmadı.
 */
type SaklamaHatirlatmasi = {
  dolanlar: Danisan[]
  onAc: (clientId: number) => void
}

type Props = {
  yedekleme: YedeklemeDurumu
  parola: ParolaFormu
  saklama: SaklamaHatirlatmasi
  depolama: DepolamaDurumu | null
  /**
   * Geri yükleme ekranını açar (tasarım §7: "uygulama içinden geri yükle
   * ekranı"). Ekranın üç felaket yolu (bozuk veritabanı, okunamayan anahtar
   * dosyası, yeni bilgisayar) `App` tarafından yönetiliyor; bu, her şey
   * çalışırken kullanılan dördüncü yol.
   */
  onGeriYukle: () => void
}

/**
 * Ayarlar sekmesi: yedekleme, parola, depolama ve saklama süresi panelleri.
 *
 * # Bu bileşen neden var
 *
 * Bu dört bölüm önceden `AnaEkran`'ı dolduruyordu: asıl iş olan takvim en
 * altta kalıyordu ve terapist her açılışta önce yedek/parola/depolama
 * durumunu geçmek zorunda kalıyordu. Ürün kararı bunları buraya, ayrı bir
 * sekmeye taşımak — hiçbir yetenek kaybolmadı, yalnızca yeri değişti.
 *
 * # Kancalar burada ÇAĞRILMIYOR
 *
 * `useYedekleme`, `useParolaFormu`, `useDanisanListesi`, `useDanisanDosyasi`
 * hâlâ `AnaEkran`'da çağrılıyor ve buraya prop olarak geçiriliyor. Sebep
 * `AnaEkran`'ın modül başlığında yazan 401 temizliği: takvim ve danışan kartı
 * 401 aldığında birbirini kapatıyor, ve o bağ yalnızca kancaların ortak
 * çağrıldığı yerde kurulabiliyor. Bu bileşeni kancalardan ayırmak o bağı
 * koparırdı.
 */
export function AyarlarSekmesi({ yedekleme, parola, saklama, depolama, onGeriYukle }: Props) {
  return (
    // `data-testid`: `TakvimSekmesi`/`DanisanlarSekmesi` ile AYNI desen —
    // sekme izolasyonu testinin (`AnaEkran.test.tsx`) bu köke ihtiyacı var.
    // `getByRole` tabanlı bir sorgu `hidden` özniteliğini (erişilebilirlik
    // ağacından) ATLAR; bir mutasyon paneli koşulsuz monte edip yalnızca
    // `hidden` ile gizlese `queryByRole` yine de `null` döner ve testi
    // YANILTIRDI (inceleme IMPORTANT-2). `data-testid` sorgusu `hidden`'ı
    // GÖRMEZDEN GELMEZ, gerçek DOM varlığını ölçer.
    <div data-testid="ayarlar-sekmesi">
      <h2 className="mb-4 text-xl font-semibold">Ayarlar</h2>

      {/* SAKLAMA HATIRLATMASI — tasarım §7: "süresi dolan dosyalar ana
          ekranda hatırlatma olarak listelenir".

          SİLME DÜĞMESİ YOK ve olmayacak: plan global kısıtı imha kararını
          her zaman insana bırakıyor. Ekran bunu açıkça yazıyor ki
          "uygulama halleder" beklentisi oluşmasın (danışan kartındaki aynı
          cümlenin eşi).

          Adlar burada görünüyor — zaten üstteki danışan listesinde de
          görünüyorlar; bu bölüm yeni bir hassas alan (risk notu, tanı, not
          içeriği) basmıyor. */}
      {saklama.dolanlar.length > 0 && (
        <section
          aria-label="Saklama süresi dolan dosyalar"
          className="mb-4 rounded border border-amber-400 bg-amber-50 p-3"
        >
          <h2 className="text-sm font-semibold text-amber-900">
            Saklama süresi dolan dosyalar ({saklama.dolanlar.length})
          </h2>
          <ul className="mt-1 flex flex-wrap gap-2 text-sm">
            {saklama.dolanlar.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="underline"
                  aria-label={`${d.ad_soyad} dosyasını aç (saklama süresi doldu)`}
                  onClick={() => saklama.onAc(d.id)}
                >
                  {d.ad_soyad}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-amber-900">
            Bu dosyalar kendiliğinden silinmez; imha kararı her zaman sizindir.
          </p>
        </section>
      )}

      {/* DEPOLAMA UYARISI — plan global kısıtındaki 500 MB eşiği.
          `depolama_durumu` Görev 7'de HTTP'ye bağlanmıştı ama arayüzde
          çağrı yeri yoktu: ekler 20 MB'a kadar BLOB tutuyor ve terapist
          veritabanı şişerken hiçbir uyarı almıyordu.

          Yalnızca eşik AŞILINCA görünür ve hiçbir şeyi ENGELLEMEZ — sunucu
          da engellemiyor (`uyari === true` iken yükleme çalışmaya devam
          eder). Eşik metni sunucudan gelen `esik` alanından basılıyor;
          istemcide ikinci bir kopya tutmak iki sayının sessizce ayrışması
          demekti. */}
      {depolama?.uyari && (
        <p
          role="status"
          className="mb-4 rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"
        >
          Ekli dosyalar {boyutBicimle(depolama.toplam_boyut)} yer kaplıyor ve{' '}
          {boyutBicimle(depolama.esik)} uyarı eşiğini aştı. Yükleme engellenmiyor;
          yedeklerinizi ve eski dosyalarınızı gözden geçirmek isteyebilirsiniz.
        </p>
      )}

      {/* YEDEKLEME — tasarım §7.
          "Yedek alınamazsa (disk dolu, klasör erişilemez) ana ekranda KALICI
          uyarı çıkar; sessiz geçilmez." Uyarı kendi kendine kaybolmaz;
          yalnızca başarılı bir yedek onu temizler.

          Bölüm HER ZAMAN görünür (uyarı olmasa da): "yedeğim alınıyor mu"
          sorusunun ekranda bir cevabı olmalı. Bu ürünün üçüncü başarı
          ölçütü "bilgisayar bozulursa veri kaybolmasın" ve o ölçüt, ancak
          kullanıcı yedeğinin durumunu görebiliyorsa karşılanır.

          Kabı artık sarı kutu DEĞİL (`AnaEkran`'da uyarı yokken bile göze
          çarpıyordu, tasarım kararı §Görev 2: bu artık bir ayarlar bölümü,
          gözden kaçmaması gereken bir bant değil). "Hiç yedek yok" bilgisi
          kutunun renginden değil, cümlesinden anlaşılır; `role="alert"`
          KALIR — o, gözden kaçmaması gereken bir bilgi olmaya devam ediyor. */}
      <section aria-label="Yedekleme" className="mb-4 rounded border p-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">Yedekleme</span>
          {yedekleme.yedek !== null && yedekleme.yedek.yedekler.length > 0 ? (
            <span>
              Son yedek: <strong>{yedekleme.yedek.yedekler[0].tarih}</strong> (
              {boyutBicimle(yedekleme.yedek.yedekler[0].boyut)}) · saklanan yedek:{' '}
              {yedekleme.yedek.yedekler.length}
            </span>
          ) : (
            <span>Henüz alınmış bir yedek yok.</span>
          )}
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs disabled:opacity-50"
            disabled={yedekleme.suruyor}
            onClick={() => void yedekleme.al()}
          >
            {yedekleme.suruyor ? 'Yedek alınıyor…' : 'Şimdi yedek al'}
          </button>
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            onClick={() => {
              yedekleme.setKlasorGirdisi(yedekleme.yedek?.hedef_dizin ?? '')
              yedekleme.setKlasorFormuAcik((acik) => !acik)
            }}
          >
            Yedek klasörünü değiştir
          </button>
          {/* Tasarim §7: "Uygulama icinden 'geri yukle' ekrani; her yedegin
              tarihi ve boyutu listelenir." Ekran uc felaket yolundan da
              (bozuk veritabani, okunamayan anahtar, yeni bilgisayar)
              acilabiliyor; AMA her sey CALISIRKEN de bir yol olmali:
              yanlislikla silinen bir danisan ya da bozulan bir not, ancak
              eski bir yedekten geri gelir ve o an ortada hicbir "felaket"
              yoktur. Ekranin kendisi iki adimli: burada yalnizca aciliyor,
              geri yukleme orada onaylaniyor. */}
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            onClick={onGeriYukle}
          >
            Yedekten geri yükle
          </button>
        </div>

        {yedekleme.yedek !== null && (
          <p className="mt-1 break-all font-mono text-xs">{yedekleme.yedek.hedef_dizin}</p>
        )}

        {/* KALICI UYARI. `role="status"` degil `role="alert"`: bu, gozden
            kacmamasi gereken bir durum -- kullanicinin verisi su an
            yedeklenmiyor. */}
        {yedekleme.uyari && (
          <p role="alert" className="mt-2">
            {yedekleme.uyari}
          </p>
        )}

        {yedekleme.klasorFormuAcik && (
          <div className="mt-2">
            <label className="block text-xs" htmlFor="yedek-klasoru-girdisi">
              Yedeklerin yazılacağı klasörün yolu
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="yedek-klasoru-girdisi"
                className="w-full rounded border p-2 font-mono text-xs"
                placeholder="/Volumes/YEDEK/terapi-yedek"
                value={yedekleme.klasorGirdisi}
                onChange={(e) => yedekleme.setKlasorGirdisi(e.target.value)}
              />
              <button
                type="button"
                className="shrink-0 rounded bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-50"
                disabled={yedekleme.suruyor || yedekleme.klasorGirdisi.trim() === ''}
                onClick={() => void yedekleme.al(yedekleme.klasorGirdisi.trim())}
              >
                Kaydet ve yedek al
              </button>
            </div>
            {/* Klasoru secmek ile ilk yedegi almak TEK islem: ayri bir
                "ayarla" adimi olsaydi, klasorunu secip yedegi almayan bir
                kullanici "yedegim var" sanirdi. Metin bunu soyluyor. */}
            <p className="mt-1 text-xs">
              Harici disk ya da bulut klasörü seçebilirsiniz; yedek dosyaları zaten
              şifrelidir. Kaydedince ilk yedek hemen alınır. Finder'da klasöre sağ tıklayıp{' '}
              <kbd>⌥</kbd> tuşuna basılıyken “… Yol Adı Olarak Kopyala” deyince yol panoya
              kopyalanır.
            </p>
          </div>
        )}
      </section>

      {/* PAROLA — `keystore::change_password` Plan 1'den beri yazılı ve
          testliydi ama hiçbir çağrı yeri yoktu: parola DEĞİŞTİRİLEMİYORDU.
          Bölüm her zaman görünür (yalnızca form katlanıyor): "parolamı nasıl
          değiştiririm" sorusunun ekranda bir cevabı olmalı. */}
      <section
        aria-label="Parola"
        className="mb-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">Parola</span>
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            onClick={parola.acKapa}
          >
            {parola.acik ? 'Vazgeç' : 'Parolayı değiştir'}
          </button>
        </div>

        {/* `role="status"`: değişiklik ekranda sessizce olup bitiyordu.
            Metin ne olduğunu VE ne OLMADIĞINI birlikte söylüyor (arşivleme
            onayıyla aynı ilke). */}
        {parola.bilgi && (
          <p role="status" className="mt-2 text-slate-700">
            {parola.bilgi}
          </p>
        )}

        {parola.acik && (
          <div className="mt-2 max-w-md">
            <div>
              <label className="block text-xs" htmlFor="mevcut-parola">
                Mevcut parolanız
              </label>
              <input
                id="mevcut-parola"
                type="password"
                autoComplete="current-password"
                className="mt-1 w-full rounded border p-2"
                value={parola.mevcutParola}
                onChange={(e) => parola.setMevcutParola(e.target.value)}
              />
            </div>
            <div className="mt-2">
              <label className="block text-xs" htmlFor="yeni-parola">
                Yeni parola
              </label>
              <input
                id="yeni-parola"
                type="password"
                autoComplete="new-password"
                className="mt-1 w-full rounded border p-2"
                value={parola.yeniParola}
                onChange={(e) => parola.setYeniParola(e.target.value)}
              />
            </div>
            <div className="mt-2">
              <label className="block text-xs" htmlFor="yeni-parola-tekrar">
                Yeni parola (tekrar)
              </label>
              <input
                id="yeni-parola-tekrar"
                type="password"
                autoComplete="new-password"
                className="mt-1 w-full rounded border p-2"
                value={parola.yeniParolaTekrar}
                onChange={(e) => parola.setYeniParolaTekrar(e.target.value)}
              />
            </div>

            {parola.hata && (
              <p role="alert" className="mt-2 text-red-600">
                {parola.hata}
              </p>
            )}

            <button
              type="button"
              className="mt-2 rounded bg-slate-900 px-3 py-2 text-xs text-white disabled:opacity-50"
              disabled={parola.suruyor}
              onClick={() => void parola.degistir()}
            >
              {parola.suruyor ? 'Değiştiriliyor…' : 'Parolayı değiştir'}
            </button>

            {/* İKİ GERÇEĞİ ÖNCEDEN söyler; kullanıcı bunları ancak
                parolasını unuttuğunda ya da eski bir yedeği geri yüklemeye
                çalıştığında -- yani çok geç -- öğrenmemeli.

                1. Kurtarma kodu DEĞİŞMEZ: veri anahtarı hem parolayla hem
                   kurtarma koduyla ayrı ayrı sarmalanıyor ve sunucudaki
                   `change_password` yalnızca parola sarmalamasını
                   yeniliyor.
                2. Eski yedekler ESKİ parolayla açılır: her yedek kendi
                   anahtar dosyasıyla birlikte alınır ve geçmişteki o
                   dosyaya dokunulmaz. */}
            <div className="mt-2 text-xs">
              <p>Kurtarma kodunuz değişmez; aynı kod çalışmaya devam eder.</p>
              <p className="mt-1">
                Bugünden önce alınmış yedekler <strong>eski</strong> parolanızla açılır — her
                yedek kendi anahtar dosyasıyla birlikte alınır. Eski parolanızı unutmayın.
              </p>
              <p className="mt-1">Oturumunuz açık kalır; yeniden giriş yapmanız gerekmez.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
