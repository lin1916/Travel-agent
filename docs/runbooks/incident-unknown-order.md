# Unknown supplier order

Treat `creation_unknown`, `payment_unknown`, and `cancellation_unknown` as non-success states. Do not retry blindly or tell the traveler the order succeeded. Preserve the request and correlation IDs, enqueue reconciliation, and mark the order for manual review when supplier lookup remains unavailable. Verify the supplier dashboard and payment ledger before any compensating action.
