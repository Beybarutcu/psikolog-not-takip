async function istek<T>(yol: string, secenekler?: RequestInit): Promise<T> {
  const yanit = await fetch(yol, {
    headers: { 'content-type': 'application/json' },
    ...secenekler,
  })
  const govde = await yanit.json().catch(() => ({}))
  if (!yanit.ok) throw new Error(govde.hata ?? 'Beklenmeyen bir hata oluştu.')
  return govde as T
}

export const api = {
  durumAl: () =>
    istek<{ kurulum_gerekli: boolean; kilitli: boolean; keystore_bozuk: boolean }>('/api/durum'),
  kurulumYap: (parola: string) =>
    istek<{ kurtarma_kodu: string }>('/api/kurulum', {
      method: 'POST',
      body: JSON.stringify({ parola }),
    }),
  kilitAc: (girdi: { parola?: string; kurtarma_kodu?: string }) =>
    istek<Record<string, never>>('/api/kilit-ac', {
      method: 'POST',
      body: JSON.stringify(girdi),
    }),
  kilitle: () => istek<Record<string, never>>('/api/kilitle', { method: 'POST' }),
}
