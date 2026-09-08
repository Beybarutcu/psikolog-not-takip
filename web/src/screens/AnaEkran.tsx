export function AnaEkran({ kilitle }: { kilitle: () => void }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Terapi Notları</h1>
      <p className="mt-2 text-slate-600">Takvim burada olacak.</p>
      <button className="mt-6 rounded-lg border px-4 py-2" onClick={kilitle}>
        Kilitle
      </button>
    </div>
  )
}
