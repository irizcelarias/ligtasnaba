"use client";
import React from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  FileUser,
  BusFront,
  MessageSquare,
  TriangleAlert,
  Settings,
  History,
  Clock3,
} from "lucide-react";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/drivers", label: "Driver Registration", icon: FileUser },
  { href: "/buses", label: "Bus Registration", icon: BusFront },
  { href: "/monitoring", label: "Iot Monitoring", icon: TriangleAlert },
  { href: "/trips", label: "Trip History", icon: Clock3 },
  { href: "/emergency", label: "Emergency Reports", icon: History },
  { href: "/feedback", label: "User Feedbacks", icon: MessageSquare },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const path = usePathname();

  return (
    <>
      <style>{css}</style>
      <aside className="admin-sidebar" style={S.aside}>
        <nav style={S.nav}>
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = path === href;
            return (
              <Link
                key={href}
                href={href}
                className={`admin-nav-link${active ? " is-active" : ""}`}
                style={{ ...S.item, ...(active ? S.active : {}) }}
              >
                <Icon size={18} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

const S = {
  aside: {
    width: 250,
    background:
      "linear-gradient(180deg, #F9FAFB 0%, #F3F4FF 40%, #EFF6FF 100%)",
    borderRight: "1px solid #E5E7EB",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    position: "sticky",
    top: 64,
    height: "calc(100vh - 64px)",
    boxShadow: "0 8px 24px rgba(15,23,42,0.04)",
  },
  header: {
    paddingBottom: 8,
    marginBottom: 8,
    borderBottom: "1px solid rgba(209,213,219,0.8)",
  },
  headerLabel: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.12,
    color: "#6B7280",
  },
  nav: {
    display: "grid",
    gap: 4,
    marginTop: 4,
    paddingTop: 4,
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 14px",
    borderRadius: 16,
    textDecoration: "none",
    color: "#4B5563",
    border: "1px solid transparent",
    background: "transparent",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  },
  active: {
    background: "#E4F1FF",
    border: "1px solid #D0E2FF",
    color: "#0D658B",
  },
};

const css = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');

.admin-sidebar {
  font-family: 'Poppins', system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

/* Smooth hover + active transitions */
.admin-nav-link {
  transition:
    background 140ms ease,
    border-color 140ms ease,
    color 140ms ease,
    transform 120ms ease;
}

.admin-nav-link svg {
  transition: color 140ms ease, opacity 140ms ease;
}

/* Hover state */
.admin-nav-link:hover {
  background: #EFF4FF;
  border-color: #D0E2FF;
  color: #0D658B;
  transform: translateX(1px);
}

/* Active state (extra polish on top of inline styles) */
.admin-nav-link.is-active {
  font-weight: 600;
}

.admin-nav-link.is-active svg {
  opacity: 1;
}
`;
