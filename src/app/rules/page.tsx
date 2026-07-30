import type { Metadata } from "next";
import RulesPageContent from "@/components/RulesPageContent";

export const metadata: Metadata = {
  title: "Rules | Office Stock League",
  description: "How to join, draft a portfolio, choose an MVP, and win the Office Stock League.",
};

export default function RulesPage() {
  return <RulesPageContent />;
}
