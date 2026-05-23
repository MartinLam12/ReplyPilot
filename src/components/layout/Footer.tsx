import React from "react";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="bg-surface-900 text-surface-300">
      <div className="container-wide py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          <div className="md:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
                <span className="text-white font-bold text-sm">R</span>
              </div>
              <span className="text-lg font-bold text-white">ReplyPilot</span>
            </Link>
            <p className="text-sm text-surface-400 leading-relaxed">
              Helping small businesses find their AI advantage. Practical recommendations, not hype.
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-white mb-4">Product</h4>
            <ul className="space-y-2.5">
              <li><a href="#features" className="text-sm text-surface-400 hover:text-white transition-colors">Features</a></li>
              <li><a href="#how-it-works" className="text-sm text-surface-400 hover:text-white transition-colors">How It Works</a></li>
              <li><Link href="/assessment" className="text-sm text-surface-400 hover:text-white transition-colors">Take Assessment</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-white mb-4">Company</h4>
            <ul className="space-y-2.5">
              <li><Link href="/about" className="text-sm text-surface-400 hover:text-white transition-colors">About</Link></li>
              <li><Link href="/contact" className="text-sm text-surface-400 hover:text-white transition-colors">Contact</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-white mb-4">Legal</h4>
            <ul className="space-y-2.5">
              <li><Link href="/privacy" className="text-sm text-surface-400 hover:text-white transition-colors">Privacy Policy</Link></li>
              <li><Link href="/terms" className="text-sm text-surface-400 hover:text-white transition-colors">Terms of Service</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-surface-800 mt-12 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-surface-500">
            © 2026 ReplyPilot. All rights reserved.
          </p>
          <p className="text-sm text-surface-500">
            Built for small businesses, by people who understand them.
          </p>
        </div>
      </div>
    </footer>
  );
}
