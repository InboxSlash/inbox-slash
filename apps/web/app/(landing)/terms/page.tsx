import type { Metadata } from "next";
import { TermsContent } from "@/app/(landing)/terms/content";

export const metadata: Metadata = {
  title: "Terms of Service - Inbox Slash",
  description: "Terms of Service - Inbox Slash",
  alternates: { canonical: "/terms" },
};

export default function Page() {
  return <TermsContent />;
}
