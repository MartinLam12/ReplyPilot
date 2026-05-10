"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { UserProvider } from "@/lib/user-context";
import { cn } from "@/lib/utils";

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === "/";
  const isAuth = pathname === "/login" || pathname === "/signup";
  const isApp = !isLanding && !isAuth;

  return (
    <UserProvider>
      <Navbar />
      <div className={cn("flex-1", isLanding && "pt-16", isApp && "pt-16 lg:pl-64")}>
        <main className="flex-1">{children}</main>
      </div>
      {isLanding && <Footer />}
    </UserProvider>
  );
}
