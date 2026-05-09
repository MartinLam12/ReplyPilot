// ============ Email Types ============

export interface IncomingEmail {
  id: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
}

export interface DraftedReply {
  subject: string;
  body: string;
}

// ============ Class Types ============

export type Location = "main" | "second" | string;

export interface GymClass {
  id: string;
  className: string;
  instructor: string;
  date: string;
  time: string;
  location: string;
  attendeeEmails: string[];
  followUpSent: boolean;
  createdAt: string;
}

export interface FollowUpDraft {
  subject: string;
  body: string;
}

// ============ UI Types ============

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";
export type BadgeVariant = "default" | "success" | "warning" | "danger" | "brand";
