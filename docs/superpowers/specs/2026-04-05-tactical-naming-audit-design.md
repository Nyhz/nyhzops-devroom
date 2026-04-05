# Tactical Naming Audit

Tighten UI-facing terminology to restore the delta-force / black-ops aesthetic. Code names must match UI labels — no translation layer.

## Changes

### Intel Board Columns
| Current | New |
|---------|-----|
| `backlog` | `tasked` |
| `planned` | `ops_ready` |

Affects: type definition, DB default, Intel Board UI, any action/query referencing column names.

### Button Labels
| Current | New | Context |
|---------|-----|---------|
| `RETRY REVIEW` | `RESUBMIT REVIEW` | Mission actions |
| `RETRY MERGE` | `REINTEGRATE` | Mission actions |
| `RETRY DEBRIEF` | `RESUBMIT DEBRIEF` | Campaign live view |
| `UPDATE ASSET` | `MODIFY ASSET` | Asset form |
| `CREATE` | `OPEN CHANNEL` | General new session modal |
| `CREATE CAMPAIGN` | `PLAN CAMPAIGN` | Campaign creation form |
| `RETRYING...` (merge) | `REINTEGRATING...` | Mission actions pending state |
| `CREATING...` (campaign) | `PLANNING...` | Campaign form pending state |

Keep as-is: CANCEL, DELETE, EDIT, RETRY BOOTSTRAP, RETRY SCAFFOLD (already thematic enough).

### LogType Enum
| Current | New |
|---------|-----|
| `log` | `comms` |
| `status` | `sitrep` |
| `error` | `alert` |

Affects: type definition, DB column default, all producers/consumers of log entries.

### MissionPriority
| Current | New |
|---------|-----|
| `normal` | `routine` |

Other values (`low`, `high`, `critical`) stay.

### MissionType
| Current | New |
|---------|-----|
| `standard` | `direct_action` |

Other values (`bootstrap`, `conflict_resolution`, `phase_debrief`) stay.

## Out of Scope
- "Template" terminology (low surface area, not worth the churn)
- Internal-only variable names that don't surface in UI
- CANCEL/DELETE/EDIT buttons (universal affordances)
- Database column renames that don't map to UI labels
