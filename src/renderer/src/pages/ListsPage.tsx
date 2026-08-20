import { useEffect, useState } from "react";
import type { ListMember, ListRecord, ListType } from "@shared/types";
import { EmptyState, Modal } from "../components/Ui";
import { useAppStore } from "../stores/appStore";

const typeLabels: Record<ListType, string> = {
  follow: "Takip Listesi",
  unfollow: "Takipten Çıkarma Listesi",
  whitelist: "Beyaz Liste",
  blacklist: "Kara Liste"
};

export function ListsPage() {
  const pushToast = useAppStore((state) => state.pushToast);
  const [lists, setLists] = useState<ListRecord[]>([]);
  const [selected, setSelected] = useState<ListRecord | null>(null);
  const [members, setMembers] = useState<ListMember[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ListType>("follow");
  const [username, setUsername] = useState("");

  async function loadLists() {
    const next = await window.api.getLists();
    setLists(next);
    setSelected((current) => current ?? next[0] ?? null);
  }

  useEffect(() => {
    void loadLists();
  }, []);

  useEffect(() => {
    if (selected) {
      void window.api.getListMembers(selected.id).then(setMembers);
    }
  }, [selected]);

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h2>Listeler</h2>
          <p>Takip, takipten çıkarma, beyaz liste ve kara liste yönetimi.</p>
        </div>
        <button className="btn primary" onClick={() => setOpen(true)}>
          Yeni liste oluştur
        </button>
      </div>
      <div className="grid two-col">
        <article className="card">
          <div className="card-body">
            {lists.map((list) => (
              <button
                key={list.id}
                className={`nav-link${selected?.id === list.id ? " active" : ""}`}
                onClick={() => setSelected(list)}
              >
                <span>
                  {list.name} · {typeLabels[list.type]}
                </span>
              </button>
            ))}
          </div>
        </article>
        <article className="card">
          <div className="card-body">
            <div className="toolbar">
              <input
                className="input"
                placeholder="Kullanıcı adı"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <button
                className="btn"
                onClick={async () => {
                  if (!selected || !username.trim()) {
                    return;
                  }
                  setMembers(await window.api.addListMember(selected.id, username));
                  setUsername("");
                }}
              >
                Listeye ekle
              </button>
              <label className="btn">
                CSV import
                <input
                  hidden
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (file && selected) {
                      setMembers(await window.api.importListCsv(selected.id, await file.text()));
                      pushToast("success", "CSV içe aktarıldı.");
                    }
                  }}
                />
              </label>
              <button
                className="btn"
                onClick={async () => {
                  if (!selected) {
                    return;
                  }
                  const csv = await window.api.exportListCsv(selected.id);
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `${selected.name}.csv`;
                  link.click();
                  URL.revokeObjectURL(url);
                }}
              >
                CSV export
              </button>
            </div>
            {members.length === 0 ? (
              <EmptyState label="Listede kullanıcı yok." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Kullanıcı adı</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id}>
                      <td>@{member.username}</td>
                      <td>
                        <button
                          className="btn danger"
                          onClick={async () => {
                            if (!selected) {
                              return;
                            }
                            setMembers(await window.api.removeListMember(selected.id, member.id));
                          }}
                        >
                          Çıkar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </article>
      </div>
      {open ? (
        <Modal title="Yeni liste" onClose={() => setOpen(false)}>
          <div className="field">
            <label>Ad</label>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Tür</label>
            <select className="select" value={type} onChange={(event) => setType(event.target.value as ListType)}>
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button
              className="btn primary"
              onClick={async () => {
                const created = await window.api.createList(name, type);
                await loadLists();
                setSelected(created);
                setOpen(false);
                setName("");
              }}
            >
              Oluştur
            </button>
            <button className="btn" onClick={() => setOpen(false)}>
              Vazgeç
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
