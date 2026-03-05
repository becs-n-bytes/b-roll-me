import { NavLink, Outlet } from "react-router";
import { useSettingsStore } from "../stores/settingsStore";

function DashboardIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={collapsed ? "rotate-180" : ""}
    >
      <path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const navItems = [
  { to: "/", label: "Dashboard", icon: DashboardIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export default function Layout() {
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-neutral-200">
      <aside
        className={`flex flex-col border-r border-neutral-800 bg-[#171717] shrink-0 ${sidebarCollapsed ? "w-16" : "w-56"}`}
      >
        <div className="flex items-center justify-between h-12 px-4 border-b border-neutral-800">
          {!sidebarCollapsed && (
            <span className="text-sm font-medium text-neutral-400 tracking-wide uppercase">Menu</span>
          )}
          <button
            onClick={toggleSidebar}
            className={`text-neutral-500 hover:text-neutral-300 ${sidebarCollapsed ? "mx-auto" : ""}`}
          >
            <CollapseIcon collapsed={sidebarCollapsed} />
          </button>
        </div>

        <nav className="flex-1 py-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm ${
                  isActive
                    ? "text-white bg-neutral-800/60"
                    : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/30"
                } ${sidebarCollapsed ? "justify-center px-0" : ""}`
              }
            >
              <item.icon />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center h-12 px-6 border-b border-neutral-800 bg-[#141414] shrink-0">
          <h1 className="text-sm font-semibold tracking-wide text-neutral-100">AI B-Roll</h1>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
