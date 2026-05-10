"use client";

import { useState, useEffect } from "react";
import { Badge, Button } from "@/components/ui";
import { listContacts, updateContactType } from "@/app/actions/contacts";
import { cn } from "@/lib/utils";
import { Users } from "lucide-react";
import type { Contact } from "@/lib/types";

const TYPE_OPTIONS: { value: Contact["type"]; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "trial", label: "Trial" },
  { value: "member", label: "Member" },
  { value: "inactive", label: "Inactive" },
];

const TYPE_BADGE: Record<Contact["type"], "default" | "brand" | "success" | "warning" | "danger"> = {
  lead: "brand",
  trial: "warning",
  member: "success",
  inactive: "default",
};

const FILTERS = [
  { value: "", label: "All" },
  { value: "lead", label: "Leads" },
  { value: "trial", label: "Trial" },
  { value: "member", label: "Members" },
  { value: "inactive", label: "Inactive" },
];

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadContacts = async (type?: string) => {
    setLoading(true);
    const data = await listContacts(type || undefined);
    setContacts(data);
    setLoading(false);
  };

  useEffect(() => {
    loadContacts(filter);
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTypeChange = async (contactId: string, type: string) => {
    await updateContactType(contactId, type);
    setContacts((prev) =>
      prev.map((c) => (c.id === contactId ? { ...c, type: type as Contact["type"] } : c))
    );
    setEditingId(null);
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-surface-900">Contacts</h1>
        <p className="text-surface-500 mt-1">
          People who have emailed your gym — synced automatically from Gmail.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
              filter === f.value
                ? "bg-brand-600 text-white"
                : "bg-white border border-surface-200 text-surface-600 hover:bg-surface-50"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-surface-100 flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-surface-400" />
          </div>
          <p className="text-surface-700 font-medium mb-1">No contacts yet</p>
          <p className="text-surface-400 text-sm">
            Contacts are created automatically when you sync your Gmail inbox.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-surface-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-100 bg-surface-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wide hidden sm:table-cell">Email</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-surface-500 uppercase tracking-wide hidden md:table-cell">Added</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact, i) => (
                <tr
                  key={contact.id}
                  className={cn("border-b border-surface-50 hover:bg-surface-50 transition-colors", i === contacts.length - 1 && "border-b-0")}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-surface-900">{contact.name || "—"}</p>
                    <p className="text-xs text-surface-400 sm:hidden">{contact.email}</p>
                  </td>
                  <td className="px-4 py-3 text-surface-600 hidden sm:table-cell">{contact.email}</td>
                  <td className="px-4 py-3">
                    {editingId === contact.id ? (
                      <select
                        autoFocus
                        value={contact.type}
                        onChange={(e) => handleTypeChange(contact.id, e.target.value)}
                        onBlur={() => setEditingId(null)}
                        className="text-xs border border-surface-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      >
                        {TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <button onClick={() => setEditingId(contact.id)} title="Click to change">
                        <Badge variant={TYPE_BADGE[contact.type]}>
                          {contact.type.charAt(0).toUpperCase() + contact.type.slice(1)}
                        </Badge>
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-surface-400 text-xs hidden md:table-cell">
                    {new Date(contact.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
