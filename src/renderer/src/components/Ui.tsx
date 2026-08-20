import type { ReactNode } from "react";

export function LoadingState({ label = "Yükleniyor..." }: { label?: string }) {
  return <div className="state">{label}</div>;
}

export function EmptyState({ label }: { label: string }) {
  return <div className="state">{label}</div>;
}

export function ErrorState({ label }: { label: string }) {
  return <div className="state">{label}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const labelMap: Record<string, string> = {
    pending: "Bekliyor",
    processing: "İşleniyor",
    success: "Başarılı",
    failed: "Başarısız",
    cancelled: "İptal",
    unsupported: "Desteklenmiyor",
    connected: "Bağlı",
    disconnected: "Bağlı Değil"
  };
  return <span className={`badge ${normalized}`}>{labelMap[normalized] ?? status}</span>;
}

export function Modal({
  title,
  children,
  onClose
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}
