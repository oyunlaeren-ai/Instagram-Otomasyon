import { useEffect, useState } from "react";
import type { HistoryDateRange, HistoryFilter, AutomationLog } from "@shared/types";
import { formatDateTime } from "@shared/utils";
import { EmptyState, StatusBadge } from "../components/Ui";

const filters: Array<{ id: HistoryFilter; label: string }> = [
  { id: "all", label: "Tümü" },
  { id: "follow", label: "FOLLOW" },
  { id: "unfollow", label: "UNFOLLOW" },
  { id: "success", label: "SUCCESS" },
  { id: "failed", label: "FAILED" },
  { id: "unsupported", label: "UNSUPPORTED" },
  { id: "cancelled", label: "CANCELLED" }
];

const dates: Array<{ id: HistoryDateRange; label: string }> = [
  { id: "today", label: "Bugün" },
  { id: "7d", label: "Son 7 gün" },
  { id: "30d", label: "Son 30 gün" },
  { id: "all", label: "Tümü" }
];

export function HistoryPage() {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<HistoryDateRange>("all");
  const [logs, setLogs] = useState<AutomationLog[]>([]);

  useEffect(() => {
    void window.api.getHistory(filter, search, dateRange).then(setLogs);
  }, [filter, search, dateRange]);

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h2>İşlem Geçmişi</h2>
          <p>Otomasyon kayıtlarını filtreleyin ve arayın.</p>
        </div>
      </div>
      <div className="toolbar">
        <div className="filters">
          {filters.map((item) => (
            <button
              key={item.id}
              className={`filter-chip${filter === item.id ? " active" : ""}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="filters">
          {dates.map((item) => (
            <button
              key={item.id}
              className={`filter-chip${dateRange === item.id ? " active" : ""}`}
              onClick={() => setDateRange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <input
          className="input"
          style={{ maxWidth: 260 }}
          placeholder="Kullanıcı adına göre ara"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <article className="card">
        <div className="card-body table-wrap">
          {logs.length === 0 ? (
            <EmptyState label="İşlem geçmişi boş." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Kullanıcı</th>
                  <th>İşlem</th>
                  <th>Durum</th>
                  <th>Hata</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.createdAt)}</td>
                    <td>@{log.username}</td>
                    <td>{log.action}</td>
                    <td>
                      <StatusBadge status={log.status} />
                    </td>
                    <td>{log.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </article>
    </section>
  );
}
