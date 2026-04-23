# Carolina Wheel Werkz Dashboard Agents

Dashboard URL: https://update-cww-app.web.app/

Firebase project:
- Project name: carolinawheelwerkz
- Project ID: carolinawheelwerkz
- Project number: 797904737702
- Parent org/folder: carolinawheelwerkz2020-org

## How the Agents Should Help

The CWW dashboard is the business control plane. BizBot agents should help Bobby operate it by turning plain English requests into safe, structured workflows.

## Primary Agents

- Dashboard Ops Agent: owns dashboard workflow planning, agent routing, and deciding whether work needs coding, QA, or automation.
- Service Advisor Agent: handles customer intake, repair notes, scheduling prep, follow-up scripts, and job prioritization.
- Growth Operator Agent: connects SEO, reviews, competitor research, lead follow-up, and revenue actions.
- System Coder Agent: implements dashboard code changes after the workflow is clear.
- QA Agent: verifies dashboard behavior before deployment.

## Safe Automation Pattern

1. Understand the business action: lead, job, customer, quote, follow-up, report, or website growth.
2. Ask only for missing data that is required to act.
3. Draft the dashboard update or workflow in a structured format.
4. If real app data needs to change, use an approved API/tool instead of pretending the change happened.
5. Route code changes to System Coder and verification to QA.
6. Keep dangerous operations behind approvals and worker policy.

## First Automations to Build

- New lead intake to job pipeline.
- Photo/request qualification checklist.
- Unscheduled lead follow-up reminders.
- Review request messages after completed jobs.
- Weekly dashboard health and revenue report.
- SEO opportunity tracker for CarolinaWheelWerkz.com.
