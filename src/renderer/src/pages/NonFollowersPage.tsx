import { useEffect, useState } from "react";
import type { RelationshipFilter, UserRecord } from "@shared/types";
import { EmptyState, LoadingState } from "../components/Ui";
import { useAppStore } from "../stores/appStore";

const filters: Array<{ id: RelationshipFilter; label: string }> = [
  { id: "not_following", label: "Takip etmiyor" },
  { id: "following", label: "Takip ediyor" },
  { id: "mutual", label: "Karşılıklı" }
];

export function NonFollowersPage() {
  const connection = useAppStore((state) => state.connection);
  const [filter, setFilter] = useState<RelationshipFilter>("not_following");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<UserRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const pageSize = 8;

  useEffect(() => {
    setLoading(true);
    void window.api.getRelationships(filter, search, page, pageSize).then((result) => {
      setItems(result.items);
      setTotal(result.total);
      setLoading(false);
    });
  }, [filter, search, page]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h2>Takip Etmeyenler</h2>
          <p>Kullanıcıların sizi takip edip etmediğini görüntüleyin.</p>
        </div>
      </div>
      {!connection.followersListSupported ? (
        <div className="hint">Bu liste mevcut API izinleriyle oluşturulamıyor.</div>
      ) : null}
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
    </section>
  );
}
