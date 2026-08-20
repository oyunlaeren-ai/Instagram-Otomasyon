export function LoadingState({ label = "Yükleniyor..." }: { label?: string }) {
  return <div className="state">{label}</div>;
}

export function EmptyState({ label }: { label: string }) {
  return <div className="state">{label}</div>;
}

export function ErrorState({ label }: { label: string }) {
  return <div className="state">{label}</div>;
}
