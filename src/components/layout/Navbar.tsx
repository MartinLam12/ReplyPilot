"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";
import {
  Menu,
  X,
  LayoutDashboard,
  Mail,
  CalendarCheck,
  Settings,
} from "lucide-react";

const navLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbox", label: "Email Reply", icon: Mail },
  { href: "/classes", label: "Class Follow-Ups", icon: CalendarCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Navbar() {
  const pathname = usePathname();
  const isLanding = pathname === "/";

  if (isLanding) return <LandingNavbar />;
  return <AppNavbar />;
}

function LandingNavbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-surface-100">
      <div className="container-wide">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
              <span className="text-white font-bold text-sm">C</span>
            </div>
            <span className="text-lg font-bold text-surface-900">ClearPath</span>
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-surface-600 hover:text-surface-900 transition-colors">
              Features
            </a>
            <a href="#how-it-works" className="text-sm text-surface-600 hover:text-surface-900 transition-colors">
              How It Works
            </a>
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <Link href="/dashboard">
              <Button size="sm">Open App</Button>
            </Link>
          </div>

          <button
            className="md:hidden p-2 text-surface-600"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-white border-t border-surface-100 py-4">
          <div className="container-wide flex flex-col gap-3">
            <a href="#features" className="text-sm text-surface-600 py-2">Features</a>
            <a href="#how-it-works" className="text-sm text-surface-600 py-2">How It Works</a>
            <hr className="border-surface-100" />
            <Link href="/dashboard">
              <Button size="sm" className="w-full">Open App</Button>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

function AppNavbar() {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <>
      {/* Top bar */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-b border-surface-100 h-16">
        <div className="flex items-center justify-between h-full px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden p-2 text-surface-600 hover:bg-surface-100 rounded-lg"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
                <span className="text-white font-bold text-sm">C</span>
              </div>
              <span className="text-lg font-bold text-surface-900">ClearPath</span>
            </Link>
          </div>

          <Link href="/inbox">
            <Button size="sm" icon={<Mail className="w-4 h-4" />}>
              Reply to Email
            </Button>
          </Link>
        </div>
      </header>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-16 left-0 z-30 h-[calc(100vh-4rem)] w-64 bg-white border-r border-surface-100 transition-transform duration-300",
          "lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <nav className="flex flex-col h-full p-4">
          <div className="flex-1 space-y-1">
            {navLinks.map((link) => {
              const isActive = pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-brand-50 text-brand-700"
                      : "text-surface-600 hover:bg-surface-50 hover:text-surface-900"
                  )}
                >
                  <link.icon className="w-5 h-5 shrink-0" />
                  {link.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </aside>

      {/* Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </>
  );
}
