// ============ Gym / Settings ============

export interface GymSettings {
  id: string;
  user_id: string;
  gym_name: string;
  gym_context: string;
  gmail_email: string | null;
  gmail_refresh_token: string | null;
  gmail_last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============ Contacts ============

export interface Contact {
  id: string;
  user_id: string;
  name: string | null;
  email: string;
  type: "lead" | "trial" | "member" | "inactive";
  notes: string | null;
  last_contacted_at: string | null;
  created_at: string;
}

// ============ Email Threads ============

export interface EmailThread {
  id: string;
  user_id: string;
  gmail_thread_id: string;
  contact_id: string | null;
  subject: string | null;
  status: "unread" | "pending_reply" | "replied" | "archived";
  last_message_at: string | null;
  gmail_history_id: string | null;
  created_at: string;
  contact?: Contact | null;
  messages?: EmailMessage[];
  latest_generation?: AIGeneration | null;
}

export interface EmailMessage {
  id: string;
  thread_id: string;
  gmail_message_id: string;
  direction: "inbound" | "outbound";
  from_email: string | null;
  to_email: string | null;
  subject: string | null;
  body_text: string | null;
  sent_at: string | null;
  created_at: string;
}

// ============ AI ============

export interface AIGeneration {
  id: string;
  user_id: string;
  thread_id: string | null;
  type: "reply" | "follow_up";
  generated_subject: string | null;
  generated_body: string | null;
  confidence: number | null;
  risk_level: "low" | "medium" | "high";
  status: "pending" | "approved" | "edited" | "rejected" | "sent";
  final_body: string | null;
  created_at: string;
}

// ============ UI Types ============

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";
export type BadgeVariant = "default" | "success" | "warning" | "danger" | "brand";
