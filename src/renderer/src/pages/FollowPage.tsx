import { useEffect, useState } from "react";
import type { QueueItem, WebAutomationJob } from "@shared/types";
import { formatDateTime } from "@shared/utils";
import { EmptyState, StatusBadge } from "../components/Ui";
import { WebSessionPanel } from "../components/WebSessionPanel";
import { useAppStore } from "../stores/appStore";

function rowStatus(item: QueueItem, jobs: WebAutomationJob[], running: boolean): string {
  const job = [...jobs].reverse().find((entry) => entry.username === item.username);
  if (job) {
    return job.status;
  }
  if (item.status === "pending" && running) {
    return "pending";
  }
  return "listed";
}

export function FollowPage() {
  const connection = useAppStore((state) => state.connection);
  const webAutomation = useAppStore((state) => state.webAutomation);
  const refresh = useAppStore((state) => state.refresh);
  const pushToast = useAppStore((state) => state.pushToast);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [jobs, setJobs] = useState<WebAutomationJob[]>([]);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [search, setSearch] = useState("");

  async function load() {
    const [queue, webJobs] = await Promise.all([
      window.api.getFollowQueue(),
      window.api.getWebAutomationQueue("FOLLOW")
    ]);
    setItems(queue);
    setJobs(webJobs);
  }

  useEffect(() => {
    void load();
  }, [webAutomation.processed, webAutomation.pending, webAutomation.running]);

  async function add() {
    const usernames = draft
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    setItems(await window.api.addFollowUsernames(usernames));
    setDraft("");
    pushToast("success", "Kullanıcılar listeye eklendi.");
  }

  async function importCsv(file: File) {
    setItems(await window.api.importFollowCsv(await file.text()));
    pushToast("success", "CSV içe aktarıldı.");
  }

  async function enqueueAndMaybeStart(start: boolean) {
    if (!connection.followSupported) {
      return;
    }
    await window.api.enqueueFollowSelected(selected.length ? selected : items.map((item) => item.id));
    if (start) {
      await window.api.startFollowAutomation();
      pushToast("info", "Takip otomasyonu başlatıldı.");
    } else {
      pushToast("success", "Seçilenler kuyruğa eklendi.");
    }
    await refresh();
    await load();
  }

  async function startWeb() {
    const usernames = (selected.length ? items.filter((item) => selected.includes(item.id)) : items).map(
      (item) => item.username
    );
    await window.api.startWebFollow(usernames);
    await refresh();
    await load();
  }

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h2>Takip</h2>
          <p>Kullanıcı listesini yönetin ve takip kuyruğunu çalıştırın.</p>
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
            <div className="hint">
              <p>Instagram'ın resmi API'si başka hesapları takip etmeyi desteklemiyor.</p>
              <p>Bu özellik mevcut resmi Meta/Instagram API sınırları nedeniyle kullanılamaz.</p>
              <p>
                Resmi Instagram API takip işlemini desteklemiyor. Bu işlem Web Otomasyonu ile Instagram web
                arayüzünde gerçekleştirilir.
              </p>
            </div>
          </div>
        </article>
        <article className="card">
          <div className="card-body">
            <h3>Instagram Web Otomasyonu</h3>
            <WebSessionPanel session={webAutomation.session} />
            <p className="hint">
              Resmi Instagram API takip işlemini desteklemiyor. Bu işlem Web Otomasyonu ile Instagram web arayüzünde
              gerçekleştirilir.
            </p>
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
            {webAutomation.lastError ? <p className="hint">{webAutomation.lastError}</p> : null}
            <p>
              Toplam: {webAutomation.total} · Başarılı: {webAutomation.success} · Zaten takip:{" "}
              {webAutomation.alreadyFollowing} · Bekleyen: {webAutomation.pending} · Başarısız: {webAutomation.failed}
            </p>
          </div>
        </article>
      </div>
      {!connection.followSupported ? (
        <div className="hint">
          <p>Instagram'ın resmi API'si başka hesapları takip etmeyi desteklemiyor.</p>
          <p>Bu özellik mevcut resmi Meta/Instagram API sınırları nedeniyle kullanılamaz.</p>
        </div>
      ) : null}
      <article className="card" style={{ marginTop: 16 }}>
        <div className="card-body">
          <textarea
            className="textarea"
            placeholder="Kullanıcı adı listesi, her satıra bir hesap"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => void add()}>
              Listeye ekle
            </button>
            <label className="btn">
              CSV yükle
              <input
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void importCsv(file);
                  }
                }}
              />
            </label>
            <button className="btn" disabled={!connection.followSupported} onClick={() => void enqueueAndMaybeStart(false)}>
              Seçilenleri takip et
            </button>
            <button className="btn success" disabled={!connection.followSupported} onClick={() => void enqueueAndMaybeStart(true)}>
              Otomasyonu başlat
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                await window.api.stopFollowAutomation();
                await refresh();
                pushToast("info", "Otomasyon durduruldu.");
              }}
            >
              Otomasyonu durdur
            </button>
          </div>
          {!connection.followSupported ? (
            <div className="hint">
              <p>Instagram'ın resmi API'si başka hesapları takip etmeyi desteklemiyor.</p>
              <p>Bu özellik mevcut resmi Meta/Instagram API sınırları nedeniyle kullanılamaz.</p>
            </div>
          ) : null}
        </div>
      </article>
      <article className="card" style={{ marginTop: 16 }}>
        <div className="card-body">
          <input
            className="input"
            placeholder="Kullanıcı ara"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="table-wrap" style={{ marginTop: 12 }}>
          {items.length === 0 ? (
            <EmptyState label="Takip kuyruğunda kullanıcı yok." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={selected.length === items.length && items.length > 0}
                      onChange={(event) => setSelected(event.target.checked ? items.map((item) => item.id) : [])}
                    />
                  </th>
                  <th>Kullanıcı adı</th>
                  <th>Durum</th>
                  <th>Son işlem</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {items
                  .filter((item) => item.username.toLowerCase().includes(search.toLowerCase()))
                  .map((item) => {
                    const status = rowStatus(item, jobs, webAutomation.running);
                    return (
                  <tr key={item.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(item.id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)
                          )
                        }
                      />
                    </td>
                    <td>@{item.username}</td>
                    <td>
                      {status === "listed" ? (
                        <span className="badge">Listede</span>
                      ) : (
                        <StatusBadge status={status} />
                      )}
                    </td>
                    <td>
                      {connection.followSupported
                        ? item.lastActionAt
                          ? formatDateTime(item.lastActionAt)
                          : "—"
                        : "Instagram'ın resmi API'si başka hesapları takip etmeyi desteklemiyor."}
                    </td>
                    <td>
                      {connection.followSupported
                        ? (item.error ?? "—")
                        : "Bu özellik mevcut resmi Meta/Instagram API sınırları nedeniyle kullanılamaz."}
                    </td>
                  </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
          </div>
        </div>
      </article>
    </section>
  );
}
