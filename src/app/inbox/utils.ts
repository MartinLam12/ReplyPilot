import type { EmailThread } from "@/lib/types";

export function senderName(thread: EmailThread): string {
  if (thread.contact?.name) return thread.contact.name;
  if (thread.contact?.email) return thread.contact.email.split("@")[0];
  return "Unknown";
}
