"use client";

import { useState } from "react";
import { Card, CardTitle, CardDescription, Button, Input } from "@/components/ui";
import { useUser } from "@/lib/user-context";
import { Save, User, Building2 } from "lucide-react";

export default function SettingsPage() {
  const { user, updateUser, initials } = useUser();
  const [saved, setSaved] = useState(false);

  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [businessName, setBusinessName] = useState(user.businessName);

  const handleSave = () => {
    updateUser({ name, email, businessName });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-surface-900">Settings</h1>
        <p className="text-surface-500 mt-1">Manage your profile and gym info</p>
      </div>

      {saved && (
        <div className="bg-success-50 border border-success-500/20 text-success-700 rounded-xl p-4 text-sm font-medium animate-fade-in">
          Settings saved!
        </div>
      )}

      {/* Profile */}
      <Card>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
            <User className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your personal information</CardDescription>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Full Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <div className="mt-4 flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-brand-100 flex items-center justify-center">
            <span className="text-xl font-bold text-brand-700">{initials || "?"}</span>
          </div>
          <p className="text-xs text-surface-400">Your initials are shown in the app</p>
        </div>
      </Card>

      {/* Business Info */}
      <Card>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-accent-50 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-accent-600" />
          </div>
          <div>
            <CardTitle>Gym Information</CardTitle>
            <CardDescription>Details about your gym</CardDescription>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Gym Name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          <Input label="Website" type="url" placeholder="https://yourgym.com" />
          <Input label="Phone" type="tel" placeholder="(555) 123-4567" />
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} icon={<Save className="w-4 h-4" />}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}
