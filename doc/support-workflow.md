# Support & Reliability Workflow (Sample)

Use this file with:

```bash
slack-ticket learn doc/support-workflow.md
```

````markdown
```slack-ticket
{
  "name": "Support & Reliability Workflow",
  "repos": ["fielded/<repo-name>"],
  "defaultProject": "PVT_kwDOAOaaZs4AlRIU",
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
    { "pattern": "fish\\s*&\\s*chips|fish and chips|special case", "projectId": "PVT_FISHCHIPS_ID" }
  ],
  "labels": {
    "keywords": {
      "user error|misuse|misconfiguration": ["User error"],
      "bug|crash|exception|error": ["bug"],
      "project:sl|support & reliability": ["Project:SL"],
      "project:psm|psm": ["Project:PSM"]
    }
  },
  "defaults": {
    "severity": "medium",
    "threadDepth": 4,
    "imageHandling": true
  },
  "prompt": {
    "create": "If the user message is unclear, write a concise summary and include the original Slack message in Details."
  },
  "instructions": "Use a clear, support-friendly tone. Keep titles short and specific."
}
```

# Team Workflow Rules

- Default board: Support & Reliability.
- If message looks like a special case, route to Fish&Chips.
- Severity should be inferred when possible (SEV 1-4); otherwise leave blank.
- If unsure about label or type, leave it unset.
````
