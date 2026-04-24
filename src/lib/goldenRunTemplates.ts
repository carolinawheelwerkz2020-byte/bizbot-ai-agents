import type { RunTemplate } from "../components/app/types";

/** Curated starter templates merged into run history (deduped by id). */
export function getGoldenRunTemplates(): RunTemplate[] {
  const createdAt = new Date(0);
  return [
    {
      id: "golden-weekly-ops-review",
      name: "Weekly ops review",
      agentId: "dashboard-ops",
      prompt:
        "Run a concise weekly ops review: summarize open jobs, follow-ups due this week, and one KPI or reporting insight. End with three prioritized actions.",
      createdAt,
      sourceRunId: "golden-seed",
      notes: "Starter — save your own templates from completed runs.",
    },
    {
      id: "golden-seo-health-pass",
      name: "SEO health pass",
      agentId: "seo-strategist",
      prompt:
        "Propose a structured SEO health check for our main service pages: technical basics, on-page gaps, and local signals. Ask for the site URL if unknown.",
      createdAt,
      sourceRunId: "golden-seed",
      notes: "Starter",
    },
    {
      id: "golden-lead-followup",
      name: "Lead follow-up draft",
      agentId: "sales",
      prompt:
        "Draft a short, professional follow-up for a warm lead who requested a quote last week. Ask for lead context if missing.",
      createdAt,
      sourceRunId: "golden-seed",
      notes: "Starter",
    },
    {
      id: "golden-handoff-plan",
      name: "Multi-agent handoff plan",
      agentId: "router",
      prompt:
        "The user wants a coordinated multi-step outcome. Propose which specialist agents should run in what order, with a clear handoff plan and success criteria.",
      createdAt,
      sourceRunId: "golden-seed",
      notes: "Starter",
    },
  ];
}

export function mergeGoldenRunTemplates(userTemplates: RunTemplate[]): RunTemplate[] {
  const golden = getGoldenRunTemplates();
  const ids = new Set(userTemplates.map((t) => t.id));
  const additions = golden.filter((g) => !ids.has(g.id));
  return [...additions, ...userTemplates].slice(0, 24);
}
