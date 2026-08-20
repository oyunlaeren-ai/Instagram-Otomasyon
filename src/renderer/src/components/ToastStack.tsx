import { useAppStore } from "../stores/appStore";

export function ToastStack() {
  const toasts = useAppStore((state) => state.toasts);
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          {toast.message}
        </div>
      ))}
    </div>
  );
}
