import type { Extensions, Mark } from '@tiptap/core'
import { FindAndReplace } from '@tiptap/extension-find-and-replace'
import { Highlight } from '@tiptap/extension-highlight'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TextAlign } from '@tiptap/extension-text-align'
import { Typography } from '@tiptap/extension-typography'
import { Placeholder, Selection } from '@tiptap/extensions'
import { StarterKit } from '@tiptap/starter-kit'
import { HorizontalRule } from '@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension'
import { NotVurgusu } from './vurgu'

/**
 * Not editörünün ve okuma görünümünün ORTAK şeması (tasarım E2, S7).
 *
 * Saklanan HTML dizgisi DOM'a hiçbir yerde doğrudan basılmaz: okuma
 * görünümü de bu uzantılarla kurulmuş bir TipTap örneğidir, dolayısıyla
 * şemada olmayan etiket (resim, betik, stil) ve öznitelik (`on*`)
 * ayrıştırmada düşer. Resim uzantısı bilerek YOK (E2: yapıştırılan/
 * sürüklenen resim düşer).
 *
 * Bağlantılar (E10): yalnızca `http:`/`https:`/`mailto:`; `javascript:`,
 * `file:` vb. ayrıştırmada bağlantı olmaktan çıkar, metin kalır. Hepsi
 * `target="_blank"` ile açılır: Tauri bu isteği `on_new_window`'da yakalar
 * ve sistem tarayıcısına devreder, uygulama penceresi asla başka siteye
 * gitmez (P6b). Düzenlenebilir yüzeyde tıklama bağlantıyı AÇMAZ (imleci
 * koyar, Word gibi düzenlenir); okuma görünümünde tıklama açar.
 *
 * `target`/`rel` ayrıştırmada da ZORLANIR (preflight F13): TipTap'ın
 * bağlantı işareti bu iki özniteliği gelen HTML'den olduğu gibi alır ve
 * işlerken seçeneklerdeki değerin ÜSTÜNE yazar; yapıştırılan
 * `<a target="_self">` uygulama penceresini bağlantıya götürmeye
 * çalışırdı.
 *
 * `TrailingNode` KAPALI (preflight F12, tasarım E8): son düğümü paragraf
 * olmayan bir not (liste, başlık, alıntı ile biten) açıldığında ilk
 * işlemde (bir tık) sona `<p></p>` ekliyordu; bu belge değişikliği
 * kullanıcı tek tuşa basmadan PUT ve silinemez `Duzenleme` satırı
 * üretirdi. Sınayan: `BicimliYuzey.test.tsx` 4.3b.
 */
const IZINLI_BAGLANTI = /^(https?:\/\/|mailto:)/i

export function baglantiIzinliMi(adres: string): boolean {
  return IZINLI_BAGLANTI.test(adres.trim())
}

const BAGLANTI_HEDEFI = '_blank'
const BAGLANTI_ILISKISI = 'noopener noreferrer'

/** StarterKit'in bağlantı işaretini `target`/`rel` ayrıştırması zorlanmış hâliyle değiştirir. */
const NotStarterKit = StarterKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map((uzanti) =>
      uzanti.name !== 'link'
        ? uzanti
        : (uzanti as Mark).extend({
            addAttributes() {
              return {
                ...this.parent?.(),
                target: { default: BAGLANTI_HEDEFI, parseHTML: () => BAGLANTI_HEDEFI },
                rel: { default: BAGLANTI_ILISKISI, parseHTML: () => BAGLANTI_ILISKISI },
              }
            },
          }),
    )
  },
})

export function notUzantilari({ duzenlenebilir }: { duzenlenebilir: boolean }): Extensions {
  return [
    NotStarterKit.configure({
      horizontalRule: false,
      trailingNode: false,
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: !duzenlenebilir,
        enableClickSelection: duzenlenebilir,
        autolink: true,
        defaultProtocol: 'https',
        isAllowedUri: (adres) => baglantiIzinliMi(adres),
        HTMLAttributes: { target: BAGLANTI_HEDEFI, rel: BAGLANTI_ILISKISI, class: null },
      },
    }),
    HorizontalRule,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TaskList,
    TaskItem.configure({
      nested: true,
      // Varsayılan erişilebilir etiket İngilizce ("Task item checkbox for
      // …", E3 ihlali — preflight/Görev 10 bulgusu); Türkçe ve bilgilendirici
      // bir etiketle değiştirilir.
      a11y: {
        checkboxLabel: (node, checked) =>
          `Görev onay kutusu: ${node.textContent || 'boş görev'}${checked ? ', tamamlandı' : ''}`,
      },
    }),
    Highlight.configure({ multicolor: true }),
    Typography,
    Superscript,
    Subscript,
    Selection,
    FindAndReplace.configure({ searchDebounceMs: 300, injectCSS: false }),
    Placeholder.configure({ placeholder: duzenlenebilir ? 'Notunuzu yazın…' : '' }),
    NotVurgusu,
  ]
}
