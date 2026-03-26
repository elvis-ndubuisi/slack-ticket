# Field Support Workflow

```slack-ticket
{
  "name": "Support & Reliability",
  "repos": ["fielded/field-supply"],
  "defaultProject": "PVT_kwDOAOaaZs4AlRIU",
  "projectFields": {
    "Status": "TODO",
    "Iteration": "latest"
  },
  "labels": {
    "keywords": {
      "user error|misuse|misconfiguration": ["User error"],
      "bug|crash|exception|error": ["bug"],
      "project:sl|support & reliability": ["Project:SL"],
      "project:psm|psm": ["Project:PSM"]
    }
  },
  "defaults": {
    "imageHandling": false
  },
  "prompt": {
    "create": "Write a crisp, specific title. Summary should be 1–2 sentences and include user impact. If the report is not concise, include the user's original Slack message as a quoted block inside Summary. Details should include any IDs, URLs, or screenshots mentioned. If this is clearly a bug and steps are present, include Steps to Reproduce as a numbered list. Do not invent steps. Keep the tone support-friendly and concise."
  },
  "instructions": "Default to the Support & Reliability board. Use TODO status. Choose the latest Iteration. Special case reports are requests to change website content (e.g., remove or edit sections on a website); route those to the Fish&Chips board. If a value cannot be set in the Project fields (e.g., severity), do not mention it in the summary/body. The tool cannot upload images; only reference that a screenshot exists if mentioned."
}
```

## Rules
- Default board: Support & Reliability.
- Status should be TODO on creation.
- Iteration should be the latest available.
- Special case reports (website content changes) should be routed to the Fish&Chips board.
- If a value cannot be set in Project fields, do not mention it in Summary or Details.
- The tool cannot upload images; do not imply the image is attached.
