/**
 * Sekme kodları — **kapalı** küme.
 *
 * Şerit `SEKME_KODLARI`'ndan türetilir; ikinci bir elle yazılmış liste yok.
 * Yeni bir sekme eklemek `SEKME_ADLARI`'na bir satır eklemektir ve şerit
 * kendiliğinden büyür (bkz. `sablon.ts`'teki aynı desen).
 */
export type SekmeKodu = 'takvim' | 'danisanlar' | 'ayarlar'

export const SEKME_ADLARI: Record<SekmeKodu, string> = {
  takvim: 'Takvim',
  danisanlar: 'Danışanlar',
  ayarlar: 'Ayarlar',
}

export const SEKME_KODLARI = Object.keys(SEKME_ADLARI) as SekmeKodu[]

/** Açılış sekmesi. Uygulamanın amacı bu; ilk görünen şey takvim olmalı. */
export const ACILIS_SEKMESI: SekmeKodu = 'takvim'
