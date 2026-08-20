import { useEffect, useState } from "react";
import { formatDateTime } from "@shared/utils";
import type { AutomationLog, DashboardStats } from "@shared/types";
import { EmptyState, ErrorState, LoadingState, StatusBadge } from "../components/Ui";
import { AccountCard } from "../components/AccountCard";
import { useAppStore } from "../stores/appStore";

function Stat({
  label,
  value,
  supported,
  unsupportedLabel
}: {
  label: string;
  value: number | null | undefined;
  supported: boolean;
  unsupportedLabel: string;
}) {
  return (
    <article className="card">
      <div className="card-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{supported ? (value ?? 0) : "—"}</div>
        {!supported ? <div className="hint">{unsupportedLabel}</div> : null}
      </div>
    </article>
  );
}

export function DashboardPage() {
  const stats = useAppStore((state) => state.stats);
  const loading = useAppStore((state) => state.loading);
  const error = useAppStore((state) => state.error);
  const connection = useAppStore((state) => state.connection);
  const [logs, setLogs] = useState<AutomationLog[]>([]);

  useEffect(() => {
    if (!window.api?.getRecentLogs) {
      return;
    }
    void window.api.getRecentLogs().then(setLogs).catch((error: unknown) => {
      console.error("[Renderer] getRecentLogs", error);
    });
  }, []);

  if (loading && !stats) {
    return (
      <section className="page">
        <div className="page-header">
          <div>
            <h2>Dashboard</h2>
            <p>Instagram Automation Manager</p>
          </div>
        </div>
        <LoadingState />
      </section>
    );
  }

  if (error) {
    return (
      <section className="page">
        <ErrorState label={error} />
      </section>
    );
  }

  const current: DashboardStats = stats ?? {
    followers: 0,
    following: 0,
    notFollowingBack: 0,
    todayFollows: 0,
    todayUnfollows: 0,
    successCount: 0,
    failedCount: 0,
    followersSupported: false,
    followingSupported: false,
    notFollowingSupported: false
  };

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h2>Dashboard</h2>
          <p>Hesap özeti, günlük işlemler ve son otomasyon kayıtları.</p>
        </div>
      </div>
      {!connection.connected ? (
        <article className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <p>Instagram hesabı bağlı değil.</p>
          </div>
        </article>
      ) : (
        <article className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <p>Instagram hesabı bağlı</p>
            <strong>
              @
              {connection.profile?.username ?? connection.account?.username ?? "hesap"}
            </strong>
          </div>
        </article>
      )}
      <AccountCard />
      <div className="grid stats-grid" style={{ marginTop: 16 }}>
        <Stat
          label="Takipçi"
          value={current.followers}
          supported={current.followersSupported}
          unsupportedLabel={connection.connected ? "Bu bilgi mevcut API izinleriyle alınamıyor." : "Instagram hesabı bağlı değil."}
        />
        <Stat
          label="Takip Edilen"
          value={current.following}
          supported={current.followingSupported}
          unsupportedLabel={connection.connected ? "Bu bilgi mevcut API izinleriyle alınamıyor." : "Instagram hesabı bağlı değil."}
        />
        <Stat
          label="Takip Etmeyen"
          value={current.notFollowingBack}
          supported={current.notFollowingSupported}
          unsupportedLabel={connection.connected ? "Bu bilgi mevcut API izinleriyle alınamıyor." : "Instagram hesabı bağlı değil."}
        />
        <Stat label="Bugünkü Takip" value={current.todayFollows} supported unsupportedLabel="" />
        <Stat label="Bugünkü Takipten Çıkarma" value={current.todayUnfollows} supported unsupportedLabel="" />
        <Stat label="Başarılı İşlemler" value={current.successCount} supported unsupportedLabel="" />
        <Stat label="Başarısız İşlemler" value={current.failedCount} supported unsupportedLabel="" />
      </div>
      <article className="card" style={{ marginTop: 18 }}>
        <div className="card-body">
          <h3>Son İşlemler</h3>
          {logs.length === 0 ? (
            <EmptyState label="Henüz işlem kaydı yok." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tarih</th>
                    <th>Kullanıcı</th>
                    <th>İşlem</th>
                    <th>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td>{formatDateTime(log.createdAt)}</td>
                      <td>@{log.username}</td>
                      <td>{log.action === "FOLLOW" ? "Takip" : "Takipten çıkarma"}</td>
                      <td>
                        <StatusBadge status={log.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </article>
    </section>
  );
}
