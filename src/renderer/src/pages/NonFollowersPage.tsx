import { useEffect, useState } from "react";
import type { RelationshipFilter, UserRecord, WebCollectedMember, WebListCollectStatus } from "@shared/types";
import { EmptyState, LoadingState } from "../components/Ui";
import { WebSessionPanel } from "../components/WebSessionPanel";
import { useAppStore } from "../stores/appStore";

const filters: Array<{ id: RelationshipFilter; label: string }> = [
  { id: "not_following", label: "Takip etmiyor" },
  { id: "following", label: "Takip ediyor" },
  { id: "mutual", label: "Karşılıklı" }
];

type WebTab = "FOLLOWING" | "FOLLOWERS" | "NONFOLLOWERS";

function downloadFile(filename: string, contents: BlobPart, type: string): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export function NonFollowersPage() {
  const connection = useAppStore((state) => state.connection);
  const webAutomation = useAppStore((state) => state.webAutomation);
  const refresh = useAppStore((state) => state.refresh);
  const listSupported = connection.followersListSupported && connection.followingListSupported;
  const [filter, setFilter] = useState<RelationshipFilter>("not_following");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<UserRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("");
  const [tab, setTab] = useState<WebTab>("FOLLOWING");
  const [webStatus, setWebStatus] = useState<WebListCollectStatus | null>(null);
  const [webMembers, setWebMembers] = useState<WebCollectedMember[]>([]);
  const [hasBoth, setHasBoth] = useState(false);
  const pageSize = 8;

  useEffect(() => {
    if (!window.api?.onWebListStatus) {
      return undefined;
    }
    return window.api.onWebListStatus(setWebStatus);
  }, []);

  async function loadWebList(username: string, nextTab: WebTab) {
    if (!username) {
      setWebMembers([]);
      setHasBoth(false);
      return;
    }
    const [members, both] = await Promise.all([
      nextTab === "NONFOLLOWERS"
        ? window.api.getWebNonFollowers(username)
        : window.api.getWebCollectedList(username, nextTab),
      window.api.hasBothWebLists(username)
    ]);
    setWebMembers(members);
    setHasBoth(both);
  }

  useEffect(() => {
    void window.api.getWebListStatus().then(setWebStatus);
  }, []);

  useEffect(() => {
    if (webStatus && !webStatus.running && source.trim()) {
      void loadWebList(source, tab);
    }
  }, [webStatus, source, tab]);

  useEffect(() => {
    if (!listSupported) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    void window.api.getRelationships(filter, search, page, pageSize).then((result) => {
      setItems(result.items);
      setTotal(result.total);
      setLoading(false);
    });
  }, [filter, search, page, listSupported]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const exportType = tab === "NONFOLLOWERS" ? "NONFOLLOWERS" : tab;

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h2>Takip Etmeyenler</h2>
          <p>Web oturumu üzerinden takipçi ve takip edilen listelerini okuyun.</p>
        </div>
      </div>

      <div className="grid two-col">
        <article className="card">
          <div className="card-body">
            <WebSessionPanel session={webAutomation.session} />
          </div>
        </article>
        <article className="card">
          <div className="card-body">
            <h3>Profil / Kullanıcı</h3>
            <div className="toolbar">
              <input
                className="input"
                placeholder="@eren"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              />
              <button
                className="btn"
                disabled={!webAutomation.session.connected || Boolean(webStatus?.running)}
                onClick={async () => {
                  await window.api.collectWebFollowing(source);
                  await refresh();
                }}
              >
                Takip Ettiklerini Getir
              </button>
              <button
                className="btn"
                disabled={!webAutomation.session.connected || Boolean(webStatus?.running)}
                onClick={async () => {
                  await window.api.collectWebFollowers(source);
                  await refresh();
                }}
              >
                Takipçilerini Getir
              </button>
              <button className="btn danger" disabled={!webStatus?.running} onClick={() => void window.api.stopWebListCollect()}>
                Durdur
              </button>
            </div>
            <p>{webStatus?.message ?? "Hazır"}</p>
            {webStatus?.lastError ? <p className="hint">{webStatus.lastError}</p> : null}
          </div>
        </article>
      </div>

      <div className="filters" style={{ marginTop: 16 }}>
        <button className={`filter-chip${tab === "FOLLOWING" ? " active" : ""}`} onClick={() => setTab("FOLLOWING")}>
          Takip Ettikleri
        </button>
        <button className={`filter-chip${tab === "FOLLOWERS" ? " active" : ""}`} onClick={() => setTab("FOLLOWERS")}>
          Takipçiler
        </button>
        <button className={`filter-chip${tab === "NONFOLLOWERS" ? " active" : ""}`} onClick={() => setTab("NONFOLLOWERS")}>
          Takip Etmeyenler
        </button>
      </div>

      <article className="card">
        <div className="card-body">
          <div className="toolbar">
            <p>Toplam: {webMembers.length}</p>
            <button
              className="btn"
              disabled={!webMembers.length}
              onClick={async () => {
                const csv = await window.api.exportWebListCsv(source, exportType);
                downloadFile(`${source || "liste"}-${tab}.csv`, csv, "text/csv");
              }}
            >
              CSV İndir
            </button>
            <button
              className="btn"
              disabled={!webMembers.length}
              onClick={async () => {
                const xlsx = await window.api.exportWebListXlsx(source, exportType);
                downloadFile(
                  `${source || "liste"}-${tab}.xlsx`,
                  decodeBase64(xlsx),
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                );
              }}
            >
              Excel İndir
            </button>
          </div>
          {tab === "NONFOLLOWERS" && !hasBoth ? (
            <p className="hint">Takip etmeyenler için hem takip edilenler hem takipçiler listesi alınmalıdır.</p>
          ) : webMembers.length === 0 ? (
            <EmptyState label="Bu listede kullanıcı yok." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Kullanıcı</th>
                  </tr>
                </thead>
                <tbody>
                  {webMembers.map((member, index) => (
                    <tr key={member.id}>
                      <td>{index + 1}</td>
                      <td>@{member.username}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </article>

      {!listSupported ? (
        <article className="card" style={{ marginTop: 16 }}>
          <div className="card-body">
            <p>Takip etmeyenler listesi alınamıyor</p>
            <p className="hint">Takip etmeyenler listesi resmi Instagram API tarafından sağlanmıyor.</p>
            <p className="hint">
              Instagram'ın resmi API'si takipçi/takip edilen kullanıcı listelerini uygulamaya sağlamıyor.
            </p>
          </div>
        </article>
      ) : (
        <>
          <div className="toolbar">
            <div className="filters">
              {filters.map((item) => (
                <button
                  key={item.id}
                  className={`filter-chip${filter === item.id ? " active" : ""}`}
                  onClick={() => {
                    setPage(1);
                    setFilter(item.id);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <input
              className="input"
              style={{ maxWidth: 260 }}
              placeholder="Kullanıcı ara"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </div>
          <article className="card">
            <div className="card-body">
              {loading ? (
                <LoadingState />
              ) : items.length === 0 ? (
                <EmptyState label="Takip etmeyen kullanıcı bulunamadı." />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Kullanıcı adı</th>
                        <th>Sizi takip ediyor</th>
                        <th>Siz takip ediyorsunuz</th>
                        <th>İlişki</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((user) => (
                        <tr key={user.id}>
                          <td>@{user.username}</td>
                          <td>{user.isFollower ? "Evet" : "Hayır"}</td>
                          <td>{user.isFollowing ? "Evet" : "Hayır"}</td>
                          <td>
                            {user.isFollower && user.isFollowing
                              ? "Karşılıklı"
                              : user.isFollowing
                                ? "Takip etmiyor"
                                : "Takip ediyor"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="pagination">
                <span>
                  {total} kayıt · Sayfa {page} / {pageCount}
                </span>
                <div className="toolbar" style={{ margin: 0 }}>
                  <button className="btn" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                    Önceki
                  </button>
                  <button className="btn" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>
                    Sonraki
                  </button>
                </div>
              </div>
            </div>
          </article>
        </>
      )}
    </section>
  );
}
