"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Dashboard", icon: "◻" },
  { href: "/websites", label: "Websites", icon: "◈" },
  { href: "/websites/new", label: "Add Website", icon: "+" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-gray-900 text-gray-300 flex flex-col h-full shrink-0">
      <div className="px-5 py-6 border-b border-gray-700">
        <span className="text-white font-semibold text-sm tracking-wide">WebRegression</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                active
                  ? "bg-gray-700 text-white"
                  : "hover:bg-gray-800 hover:text-white"
              }`}
            >
              <span className="text-xs">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 border-t border-gray-700">
        <form action="/auth/logout" method="post">
          <button
            type="submit"
            className="w-full rounded-md border border-gray-700 px-3 py-2 text-left text-xs font-medium text-gray-300 transition hover:border-gray-600 hover:bg-gray-800 hover:text-white"
          >
            Logout
          </button>
        </form>
        <p className="mt-3 text-xs text-gray-500">v1.0.0</p>
      </div>
    </aside>
  );
}
