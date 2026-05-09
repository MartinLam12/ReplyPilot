"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useUser } from "@/lib/user-context";
import { Button } from "@/components/ui";
import {
  Menu,
  X,
  LayoutDashboard,
  Mail,
  CalendarCheck,
  Settings,
  LogOut,
  User,
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
  const isAuth = pathname === "/login" || pathname === "/signup";

  if (isAuth) return null;

  if (isLanding) {
    return <LandingNavbar />;
  }

  return <AppNavbar />;
}

function LandingNavbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isLoggedIn } = useUser();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-surface-100">
      <div className="container-wide">
        <div className="flex items-center justify-between h-16">
          <Link href={isLoggedIn ? "/dashboard" : "/"} className="flex items-center gap-2">
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
            <Link href="/login">
              <Button variant="ghost" size="sm">Log In</Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">Get Started</Button>
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
            <Link href="/login">
              <Button variant="ghost" size="sm" className="w-full">Log In</Button>
            </Link>
            <Link href="/signup">
              <Button size="sm" className="w-full">Get Started</Button>
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
  const { user, initials, clearUser, isLoggedIn } = useUser();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await clearUser();
    window.location.href = "/";
  };

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
            <Link href={isLoggedIn ? "/dashboard" : "/"} className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
                <span className="text-white font-bold text-sm">C</span>
              </div>
              <span className="text-lg font-bold text-surface-900">ClearPath</span>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/inbox">
              <Button size="sm" icon={<Mail className="w-4 h-4" />}>
                Reply to Email
              </Button>
            </Link>

            {/* Avatar with dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setAvatarOpen(!avatarOpen)}
                className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-brand-300 transition-all"
              >
                <span className="text-brand-700 text-sm font-medium">
                  {initials || <User className="w-4 h-4" />}
                </span>
              </button>

              {avatarOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl border border-surface-200 shadow-soft-lg py-2 z-50 animate-fade-in">
                  {/* User info header */}
                  {user.name && (
                    <div className="px-4 py-2.5 border-b border-surface-100">
                      <p className="text-sm font-semibold text-surface-900 truncate">{user.name}</p>
                      {user.email && (
                        <p className="text-xs text-surface-500 truncate">{user.email}</p>
                      )}
                    </div>
                  )}

                  <div className="py-1">
                    <Link
                      href="/settings"
                      onClick={() => setAvatarOpen(false)}
                      className="flex items-center gap-3 px-4 py-2 text-sm text-surface-600 hover:bg-surface-50 hover:text-surface-900 transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                      Settings
                    </Link>
                  </div>

                  <div className="border-t border-surface-100 py-1">
                    <button
                      onClick={handleSignOut}
                      className="w-full flex items-center gap-3 px-4 py-2 text-sm text-surface-500 hover:bg-surface-50 hover:text-surface-900 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
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
          <div className="border-t border-surface-100 pt-4">
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-surface-500 hover:bg-surface-50 hover:text-surface-900 transition-all duration-200 cursor-pointer"
            >
              <LogOut className="w-5 h-5" />
              Sign Out
            </button>
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
