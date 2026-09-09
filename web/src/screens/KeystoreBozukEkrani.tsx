/**
 * Anahtar dosyası okunamadığında gösterilen ekran.
 *
 * Bu, üründeki en yüksek riskli metin: onu okuyan kişi tek başına çalışan bir
 * psikolog ve yıllarca birikmiş danışan kaydına erişemiyor. İki kural metnin
 * biçimini belirliyor:
 *
 * 1. **Ürünün bugün yapamadığı bir şeyi tarif etme.** Bu kural metni bir kez
 *    daha değiştirdi: `backup::yedek_al` artık ürüne bağlı ve uygulamanın
 *    kendi geri yükleme ekranı var. Bu yüzden metnin başına o ekrana giden
 *    bir düğme eklendi ve "uygulama şu an kendiliğinden yedek almıyor"
 *    cümlesi kaldırıldı — artık doğru değil. Koşullu kısım ("yedeğiniz
 *    varsa") duruyor: klasörünü hiç seçmemiş bir kullanıcının yedeği hâlâ
 *    olmayabilir ve onu var olmayan bir klasörü aramaya göndermek eskisinden
 *    çaresiz bırakır.
 * 2. **Elle prosedür, kodun yaptığı işin aynısını yaptırmalı.**
 *    `backup::geri_yukle` yerleştirmeden sonra `veri.db-wal`/`veri.db-shm`'yi
 *    siler ("WAL dosyalari eski veritabanina aitti, birakilirsa tutarsizlik
 *    uretir"). Uygulama bağlantıyı oturum boyunca açık tuttuğu için çökme
 *    anında veri dizininde neredeyse her zaman bir WAL vardır; bu adım metinden
 *    düşerse kullanıcı geri yüklediği veritabanını ilk denemesinde bozar.
 */
export function KeystoreBozukEkrani({
  veriDizini,
  onGeriYukle,
}: {
  veriDizini: string
  /** Uygulamanın kendi geri yükleme ekranını açar. */
  onGeriYukle: () => void
}) {
  return (
    <div className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-semibold text-red-700">Anahtar dosyası okunamıyor</h1>
      <p className="mt-3 text-sm text-slate-600">
        Uygulama, şifreli kayıtlarınızın anahtarını tutan <code>keystore.json</code> dosyasını
        okuyamadı. Dosya bozulmuş veya eksik olabilir.
      </p>
      <p className="mt-3 rounded-lg bg-red-50 p-4 text-sm text-red-700">
        <strong>Bu dosyayı silmeyin.</strong> Silmek, şifreli kayıtlarınıza kalıcı olarak
        erişiminizi kaybetmenize yol açar.
      </p>

      <h2 className="mt-6 text-base font-semibold">Önce: kayıtlarınızın bir kopyasını alın</h2>
      <p className="mt-2 text-sm text-slate-600">
        Kayıtlarınız hâlâ bilgisayarınızda duruyor. Uygulamanın veri klasörü şurası:
      </p>
      <p className="mt-2 select-all break-all rounded-lg bg-slate-100 p-3 font-mono text-xs text-slate-800">
        <code>{veriDizini}</code>
      </p>
      <p className="mt-2 text-sm text-slate-600">
        Bu klasörde <code>veri.db</code> (kayıtlarınız) ve <code>keystore.json</code> (onları açan
        anahtar) bulunur. Finder bu klasörü normalde göstermez; açmak için Finder'da{' '}
        <strong>Git &rsaquo; Klasöre Git</strong> (<kbd>⇧</kbd>+<kbd>⌘</kbd>+<kbd>G</kbd>) deyip
        yukarıdaki yolu yapıştırın.
      </p>
      <p className="mt-2 text-sm text-slate-600">
        Başka bir şey denemeden önce <strong>bu klasörün tamamını</strong> harici bir diske ya da
        USB belleğe kopyalayın. Bundan sonra ne yaparsanız yapın, o kopya elinizde kalır.
      </p>

      <h2 className="mt-6 text-base font-semibold">Bir yedeğiniz varsa</h2>
      <p className="mt-2 text-sm text-slate-600">
        Her yedek <strong>iki dosyadan</strong> oluşur: kayıtlarınızın kopyası
        (<code>yedek-TARİH.db</code>) ve o kopyayı açan anahtar dosyası
        (<code>yedek-TARİH.keystore.json</code>). Bu ikisi birlikte geri yüklendiğinde uygulama,
        o yedeğin alındığı gündeki parolanızla yeniden açılır.
      </p>
      <button
        type="button"
        className="mt-3 w-full rounded-lg bg-slate-900 py-2 text-sm text-white"
        onClick={onGeriYukle}
      >
        Yedekten geri yükle
      </button>
      <p className="mt-2 text-sm text-slate-600">
        Uygulamanın kendi geri yükleme ekranı çifti birlikte yerleştirir ve aşağıdaki elle
        yapılacak adımların hepsini sizin için yapar. Çalışmazsa elle de yapabilirsiniz:
      </p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600">
        <li>
          Uygulamayı kapatın ve yedek klasörünüzü açın. En yeni tarihli, <strong>ikisi de</strong>{' '}
          yerinde olan yedek çiftini seçin.
        </li>
        <li>
          Bu iki dosyayı yukarıdaki veri klasörüne kopyalayın; <code>.db</code> dosyasını{' '}
          <code>veri.db</code>, <code>.keystore.json</code> dosyasını <code>keystore.json</code>{' '}
          olarak adlandırın.
        </li>
        <li>
          Aynı klasörde <code>veri.db-wal</code> veya <code>veri.db-shm</code> adlı dosyalar varsa{' '}
          <strong>onları da silin</strong>. Bunlar eski veritabanına ait geçici dosyalardır; yerinde
          bırakılırsa geri yüklediğiniz kayıtlarla karışır ve veritabanını yeniden bozarlar.
        </li>
        <li>
          Uygulamayı yeniden başlatıp <strong>o yedeğin alındığı tarihteki parolanızla</strong>{' '}
          girin. Parolanızı hatırlamıyorsanız kurulumda aldığınız kurtarma kodunu kullanın.
        </li>
      </ol>

      <h2 className="mt-6 text-base font-semibold">Yedeğiniz yoksa</h2>
      <p className="mt-2 text-sm text-slate-600">
        Yedeğiniz yoksa bu ekran son söz değil: kayıtlarınız şifreli hâlde yerinde duruyor ve
        eksik olan yalnızca onları açan anahtar. Kopyasını aldığınız sürece durum geri
        döndürülebilir kalır.
      </p>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">
        <li>
          <code>veri.db</code> ve <code>keystore.json</code> dosyalarını silmeyin ve üzerlerine
          yazmayın.
        </li>
        <li>
          <strong>Yeniden kurulum yapmayın.</strong> Yeni kurulum yeni bir anahtar üretip
          eskisinin yerine geçer; o andan sonra mevcut kayıtlarınız hiçbir parolayla açılamaz.
        </li>
        <li>
          <code>keystore.json</code>'ın sağlam bir kopyası sonradan ortaya çıkarsa (örneğin bir
          Time Machine yedeğinde ya da eski bir bilgisayarda), onu veri klasörüne geri koyup —
          yanındaki <code>veri.db-wal</code> ve <code>veri.db-shm</code> dosyalarını silerek —
          kayıtlarınıza yeniden erişebilirsiniz.
        </li>
      </ul>
    </div>
  )
}
