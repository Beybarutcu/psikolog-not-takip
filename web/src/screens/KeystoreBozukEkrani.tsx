export function KeystoreBozukEkrani() {
  return (
    <div className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-semibold text-red-700">Anahtar dosyası okunamıyor</h1>
      <p className="mt-3 text-sm text-slate-600">
        Uygulama, şifreli kayıtlarınızın anahtarını tutan <code>keystore.json</code> dosyasını
        okuyamadı. Dosya bozulmuş veya eksik olabilir.
      </p>
      <p className="mt-3 rounded-lg bg-red-50 p-4 text-sm text-red-700">
        <strong>Bu dosyayı silmeyin.</strong> Silmek, şifreli kayıtlarınıza kalıcı olarak erişimi
        kaybetmenize yol açar.
      </p>

      <h2 className="mt-6 text-base font-semibold">Ne yapabilirsiniz</h2>
      <p className="mt-2 text-sm text-slate-600">
        Yedek klasörünüzde her yedek <strong>iki dosyadan</strong> oluşur: kayıtlarınızın kopyası
        (<code>yedek-TARİH.db</code>) ve o kopyayı açan anahtar dosyası (
        <code>yedek-TARİH.keystore.json</code>). Bu ikisi birlikte geri yüklendiğinde uygulama, o
        yedeğin alındığı gündeki parolanızla yeniden açılır.
      </p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600">
        <li>
          Uygulamayı kapatın ve yedek klasörünüzü açın. En yeni tarihli, <strong>ikisi de</strong>{' '}
          yerinde olan yedek çiftini seçin.
        </li>
        <li>
          Bu iki dosyayı uygulamanın veri klasörüne kopyalayın; <code>.db</code> dosyasını{' '}
          <code>veri.db</code>, <code>.keystore.json</code> dosyasını <code>keystore.json</code>{' '}
          olarak adlandırın.
        </li>
        <li>
          Uygulamayı yeniden başlatıp <strong>o yedeğin alındığı tarihteki parolanızla</strong>{' '}
          girin. Parolanızı hatırlamıyorsanız kurulumda aldığınız kurtarma kodunu kullanın.
        </li>
      </ol>
      <p className="mt-3 text-sm text-slate-600">
        Elinizdeki dosyaların hiçbiri açılmıyorsa, kopyalarını olduğu gibi saklayın. Yeni bir
        kurulum yapmak bu dosyaları geçersiz kılmaz, ancak eskilerinin üzerine yazmayın.
      </p>
    </div>
  )
}
