import { useEffect, useState } from "react";
import type { UnfollowFilter, UserRecord, WebAutomationJob } from "@shared/types";
import { formatDateTime } from "@shared/utils";
import { EmptyState, StatusBadge } from "../components/Ui";
import { WebSessionPanel } from "../components/WebSessionPanel";
import { useAppStore } from "../stores/appStore";

const filters: Array<{ id: UnfollowFilter; label: string }> = [
  { id: "not_following_back", label: "Beni takip etmeyenler" },
  { id: "selected", label: "Seçilen kullanıcılar" },
  { id: "blacklisted", label: "Kara listedekiler" }
];

export function UnfollowPage() {
  const connection = useAppStore((state) => state.connection);
  const webAutomation = useAppStore((state) => state.webAutomation);
  const refresh = useAppStore((state) => state.refresh);
  const pushToast = useAppStore((state) => state.pushToast);
  const [filter, setFilter] = useState<UnfollowFilter>("not_following_back");
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [jobs, setJobs] = useState<WebAutomationJob[]>([]);

  useEffect(() => {
    void window.api.getUnfollowQueue(filter).then(setUsers);
  }, [filter]);

  useEffect(() => {
    void Promise.all([window.api.getWebAutomationQueue("UNFOLLOW")]).then(([webJobs]) => setJobs(webJobs));
  }, [webAutomation.processed, webAutomation.pending, webAutomation.running]);

  async function startWeb() {
    const fromDraft = draft
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const usernames = [...new Set([...selected, ...fromDraft, ...jobs.map((job) => job.username)])];
    await window.api.startWebUnfollow(usernames);
    await refresh();
    setJobs(await window.api.getWebAutomationQueue("UNFOLLOW"));
  }

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h2>Takipten Çıkarma</h2>
          <p>Filtreleyin, seçin ve kuyruğa alın.</p>
        </div>
      </div>
      <div className="grid two-col">
        <article className="card">
          <div className="card-body">
            <h3>Instagram API</h3>
            <p>
              <span
                className="status-dot"
                style={{ background: connection.connected ? "var(--success)" : "var(--danger)" }}
              />
              {connection.connected ? "Hesap bağlı" : "Hesap bağlı değil"}
            </p>
            {!connection.unfollowSupported ? (
              <div className="hint">
                <p>Instagram'ın resmi API'si başka hesapları takipten çıkarmayı desteklemiyor.</p>
                <p>Bu özellik mevcut resmi Meta/Instagram API sınırları nedeniyle kullanılamaz.</p>
                <p>
                  Resmi Instagram API takipten çıkarmayı desteklemiyor. Bu işlem Web Otomasyonu ile Instagram web
                  arayüzünde gerçekleştirilir.
                </p>
              </div>
            ) : null}
          </div>
        </article>
        <article className="card">
          <div className="card-body">
            <h3>Instagram Web Otomasyonu</h3>
            <WebSessionPanel session={webAutomation.session} />
            <textarea
              className="textarea"
              placeholder="@kullanici1&#10;@kullanici2"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="toolbar">
              <button className="btn success" disabled={!webAutomation.session.connected} onClick={() => void startWeb()}>
                Web Otomasyonunu Başlat
              </button>
              <button className="btn" disabled={!webAutomation.running} onClick={() => void window.api.pauseWebAutomation()}>
                Duraklat
              </button>
              <button
                className="btn"
                disabled={!webAutomation.paused && !webAutomation.interrupted}
                onClick={() => void window.api.resumeWebAutomation()}
              >
                Devam Et
              </button>
              <button className="btn danger" onClick={() => void window.api.stopWebAutomation()}>
                Durdur
              </button>
            </div>
            <p>
              Toplam: {webAutomation.total} · Başarılı: {webAutomation.success} · Zaten takip edilmiyor:{" "}
              {webAutomation.alreadyUnfollowed} · Bekleyen: {webAutomation.pending} · Başarısız: {webAutomation.failed}
            </p>
            {jobs.length > 0 ? (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Kullanıcı</th>
                      <th>Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id}>
                        <td>@{job.username}</td>
                        <td>
                          <StatusBadge status={job.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </article>
      </div>
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
      <div className="toolbar">
        <button className="btn" onClick={() => setSelected(users.map((user) => user.username))}>
          Tümünü seç
        </button>
        <button className="btn" onClick={() => setSelected([])}>
          Seçimi kaldır
        </button>
        <button
          className="btn"
          disabled={!connection.unfollowSupported}
          onClick={async () => {
            if (!connection.unfollowSupported) {
              return;
            }
            await window.api.enqueueUnfollowSelected(selected);
            pushToast("success", "Seçilenler kaldırılmak üzere kuyruğa alındı.");
          }}
        >
          Seçilenleri kaldır
        </button>
        <button
          className="btn success"
          disabled={!connection.unfollowSupported}
          onClick={async () => {
            if (!connection.unfollowSupported) {
              return;
            }
            if (selected.length) {
              await window.api.enqueueUnfollowSelected(selected);
            }
            await window.api.startUnfollowAutomation();
            await refresh();
            pushToast("info", "Takipten çıkarma otomasyonu başlatıldı.");
          }}
        >
          Otomasyonu başlat
        </button>
        <button
          className="btn danger"
          onClick={async () => {
            await window.api.stopUnfollowAutomation();
            await refresh();
          }}
        >
          Otomasyonu durdur
        </button>
      </div>
      {!connection.unfollowSupported ? (
        <div className="hint">
          <p>Instagram'ın resmi API'si başka hesapları takipten çıkarmayı desteklemiyor.</p>
          <p>Bu özellik mevcut resmi Meta/Instagram API sınırları nedeniyle kullanılamaz.</p>
        </div>
      ) : null}
      <article className="card">
        <div className="card-body table-wrap">
          {users.length === 0 ? (
            <EmptyState label="Bu filtre için kullanıcı bulunamadı." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={selected.length === users.length}
                      onChange={(event) => setSelected(event.target.checked ? users.map((user) => user.username) : [])}
                    />
                  </th>
                  <th>Profil</th>
                  <th>Kullanıcı adı</th>
                  <th>Takip durumu</th>
                  <th>Takip tarihi</th>
                  <th>Son işlem</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(user.username)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, user.username]
                              : current.filter((name) => name !== user.username)
                          )
                        }
                      />
                    </td>
                    <td>{user.displayName ?? "—"}</td>
                    <td>@{user.username}</td>
                    <td>{user.isFollower ? "Sizi takip ediyor" : "Takip etmiyor"}</td>
                    <td>{user.followedAt ? formatDateTime(user.followedAt) : "—"}</td>
                    <td>{user.lastActionAt ? formatDateTime(user.lastActionAt) : "—"}</td>
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
