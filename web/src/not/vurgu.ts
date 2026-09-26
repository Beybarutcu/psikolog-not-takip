import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
// Türkçe katlama ortak modülde (tasarım §9): vurgu ve danışan araması AYNI işlevi kullanır.
import { katla } from '../katla'

/** Sunucudaki `ASGARI_SORGU` (2) ile aynı: daha kısa terim vurgulanmaz. */
export const ASGARI_VURGU = 2

export function eslesmeAraliklari(metin: string, terim: string): Array<[number, number]> {
  const hedef = katla(terim.trim())
  if (hedef.length < ASGARI_VURGU) return []
  const katli = katla(metin)
  const araliklar: Array<[number, number]> = []
  let konum = katli.indexOf(hedef)
  while (konum !== -1) {
    araliklar.push([konum, konum + hedef.length])
    konum = katli.indexOf(hedef, konum + hedef.length)
  }
  return araliklar
}

export function vurguParcalari(metin: string, terim: string): Array<{ metin: string; vurgu: boolean }> {
  const parcalar: Array<{ metin: string; vurgu: boolean }> = []
  let onceki = 0
  for (const [bas, son] of eslesmeAraliklari(metin, terim)) {
    if (bas > onceki) parcalar.push({ metin: metin.slice(onceki, bas), vurgu: false })
    parcalar.push({ metin: metin.slice(bas, son), vurgu: true })
    onceki = son
  }
  if (onceki < metin.length || parcalar.length === 0) parcalar.push({ metin: metin.slice(onceki), vurgu: false })
  return parcalar
}

type VurguDurumu = { terim: string; susler: DecorationSet }
const vurguAnahtari = new PluginKey<VurguDurumu>('notVurgusu')

/**
 * Her metin bloğunda işaretler (kalın, vurgu…) metni kaç düğüme bölerse
 * bölsün blok TEK dizgi olarak aranır; `konumlar[i]` dizginin i. biriminin
 * belge konumudur. Satır içi atom düğümler (ör. satır sonu) tek yer
 * tutucuyla sayılır.
 */
function suslemeleriKur(belge: PMNode, terim: string): DecorationSet {
  if (katla(terim.trim()).length < ASGARI_VURGU) return DecorationSet.empty
  const suslemeler: Decoration[] = []
  belge.descendants((dugum, konum) => {
    if (!dugum.isTextblock) return true
    let metin = ''
    const konumlar: number[] = []
    dugum.forEach((cocuk, ofset) => {
      const bas = konum + 1 + ofset
      if (cocuk.isText) {
        const t = cocuk.text ?? ''
        for (let i = 0; i < t.length; i++) {
          metin += t[i]
          konumlar.push(bas + i)
        }
      } else {
        metin += '￼'
        konumlar.push(bas)
      }
    })
    for (const [bas, son] of eslesmeAraliklari(metin, terim)) {
      suslemeler.push(Decoration.inline(konumlar[bas], konumlar[son - 1] + 1, { class: 'not-vurgu' }))
    }
    return false
  })
  return DecorationSet.create(belge, suslemeler)
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    notVurgusu: {
      /** Terimi (Türkçe harf duyarsız) bütün eşleşmelerde işaretler; boş terim temizler. */
      vurguAyarla: (terim: string) => ReturnType
    }
  }
}

/** Önceki notlarda aranan terimin okuma görünümündeki vurgusu (tasarım N7). Belgeyi DEĞİŞTİRMEZ. */
export const NotVurgusu = Extension.create({
  name: 'notVurgusu',
  addCommands() {
    return {
      vurguAyarla:
        (terim: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(vurguAnahtari, terim)
          return true
        },
    }
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<VurguDurumu>({
        key: vurguAnahtari,
        state: {
          init: () => ({ terim: '', susler: DecorationSet.empty }),
          apply: (tr, onceki) => {
            const yeni = tr.getMeta(vurguAnahtari) as string | undefined
            if (yeni === undefined && !tr.docChanged) return onceki
            const terim = yeni ?? onceki.terim
            return { terim, susler: suslemeleriKur(tr.doc, terim) }
          },
        },
        props: { decorations: (durum) => vurguAnahtari.getState(durum)?.susler },
      }),
    ]
  },
})
