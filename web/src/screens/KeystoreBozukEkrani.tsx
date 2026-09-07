export function KeystoreBozukEkrani() {
  return (
    <div className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-semibold text-red-700">Anahtar dosyası okunamıyor</h1>
      <p className="mt-3 text-sm text-slate-600">
        Uygulama, şifreli verilerinizin anahtarını tutan dosyayı okuyamadı. Dosya bozulmuş veya
        eksik olabilir.
      </p>
      <p className="mt-3 rounded-lg bg-red-50 p-4 text-sm text-red-700">
        <strong>Bu dosyayı silmeyin.</strong> Silmek, şifreli verilerinize kalıcı olarak erişimi
        kaybetmenize yol açar.
      </p>
      <p className="mt-3 text-sm text-slate-600">
        Devam etmek için bir yedekten geri yükleme yapmanız gerekebilir. Yardım için teknik
        desteğe başvurun.
      </p>
    </div>
  )
}
