import { NavLink, Outlet } from "react-router-dom";
import { TopBar } from "./TopBar";

const links = [
  { to: "/", label: "Dashboard" },
  { to: "/follow", label: "Takip" },
  { to: "/unfollow", label: "Takipten Çıkarma" },
  { to: "/non-followers", label: "Takip Etmeyenler" },
  { to: "/lists", label: "Listeler" },
  { to: "/automation", label: "Otomasyon" },
  { to: "/history", label: "İşlem Geçmişi" },
  { to: "/settings", label: "Ayarlar" }
];

export function AppLayout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <h1>Instagram Automation</h1>
            <p>Yönetim paneli</p>
          </div>
        </div>
        <nav>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/"}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              <span>{link.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="content">
        <TopBar />
        <Outlet />
      </main>
    </div>
  );
}
