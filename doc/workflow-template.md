# Team Workflow Template

Use this as a starting point for `slack-ticket learn`.

````markdown
```slack-ticket
{
  "name": "Support QA",
  "repos": ["acme/support", "acme/web"],
  "defaultProject": "PVT_kwDOA...",
  "projectFields": {
    "Status": "TODO",
    "Iteration": "latest",
    "Severity": "SEV 3",
    "UPS Score": 10,
    "Tenant": "ALL",
    "Pod": "Fish&Chips",
    "Priority": "P2",
    "Size": "M",
    "Related Feature": "Orders Sync",
    "Recurring Bug": "Yes"
  },
  "projectRouting": [
    { "pattern": "billing|invoice|chargeback", "projectId": "PVT_kwDOA..." },
    { "pattern": "login|auth|sso", "projectId": "PVT_kwDOB..." }
  ],
  "labels": {
    "keywords": {
      "refund|chargeback": ["billing", "priority:high"],
      "crash|exception": ["bug"]
    },
    "severity": {
      "critical": ["priority:critical"],
      "high": ["priority:high"]
    },
    "components": {
      "payments": ["component:payments"],
      "auth": ["component:auth"]
    }
  },
  "defaults": {
    "severity": "medium",
    "component": "auth",
    "threadDepth": 4,
    "imageHandling": true
  },
  "prompt": {
    "create": "Always include a brief customer-impact sentence in Summary.",
    "update": "Keep updates short and bullet-pointed."
  },
  "instructions": "Use a friendly, non-technical tone. Add a Checklist section when possible."
}
```

# Team Workflow Rules

- If a ticket mentions refunds or chargebacks, treat it as billing-focused.
- Include a short customer-impact sentence in Summary.
- For bugs, prefer numbered steps in Steps to Reproduce when possible.
````
