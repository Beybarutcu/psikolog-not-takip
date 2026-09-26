/**
 * Editör "boş" mu (tasarım E9: dolu editörde şablon değişimi metni ezmez).
 * İçerik artık HTML: TipTap boş belgeyi `<p></p>` olarak bildirir, yani
 * eski `icerik.trim() === ''` ölçütü yazılmış hiçbir şey yokken de "dolu"
 * derdi. Etiketler ve boşluk (`&nbsp;` dâhil) atılınca hiçbir şey
 * kalmıyorsa boştur. Şablon başlığı (`<h2>Veri</h2>`) METİNDİR: başlıklı bir
 * not boş sayılmaz, şablon değişimi onu ezmez.
 */
export function htmlBosMu(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === ''
}
