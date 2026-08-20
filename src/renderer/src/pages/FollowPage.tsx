import { useEffect, useState } from "react";
import type { QueueItem } from "@shared/types";
import { formatDateTime } from "@shared/utils";
import { EmptyState, StatusBadge } from "../components/Ui";
import { useAppStore } from "../stores/appStore";

export function FollowPage() {
  const connection = useAppStore((state) => state.connection);
  const refresh = useAppStore((state) => state.refresh);
  const pushToast = useAppStore((state) => state.pushToast);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [search, setSearch] = useState("");

  async function load() {
    setItems(await window.api.getFollowQueue());
  }

  useEffect(() => {
    void load();
  }, []);

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
      pushToast("error", "Bu işlem mevcut Instagram API izinleriyle kullanılamıyor.");
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

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h2>Takip</h2>
          <p>Kullanıcı listesini yönetin ve takip kuyruğunu çalıştırın.</p>
        </div>
      </div>
      {!connection.followSupported ? (
        <p className="hint">Bu işlem mevcut Instagram API izinleriyle kullanılamıyor.</p>
      ) : null}
      <article className="card">
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
            <div className="hint">Takip Et işlemi mevcut Instagram API izinleriyle kullanılamıyor.</div>
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
                  .map((item) => (
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
                      <StatusBadge status={item.status} />
                    </td>
                    <td>{item.lastActionAt ? formatDateTime(item.lastActionAt) : "—"}</td>
                    <td>{item.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>
        </div>
      </article>
    </section>
  );
}
