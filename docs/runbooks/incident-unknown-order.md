# Unknown supplier order

Treat `creation_unknown`, `payment_unknown`, and `cancellation_unknown` as non-success states. Do not retry blindly or tell the traveler the order succeeded. Preserve the request and correlation IDs, enqueue reconciliation, and mark the order for manual review when supplier lookup remains unavailable. Verify the supplier dashboard and payment ledger before any compensating action.

Worker recovery: pause new deploys, inspect the task lease and `last_error`, and restart only the affected worker. Expired leases are reclaimed by `TaskRunner`; do not delete tasks. If the task reaches `dead_letter`, capture its task ID, request/correlation IDs, supplier response, and audit entry, then replay through the reconciliation queue after the supplier confirms the authoritative state. Escalate when a second replay remains unknown.
