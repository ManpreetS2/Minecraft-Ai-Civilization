# Per-scenario journal-CLI controls (real subprocesses, real bundles, measured at the code SHA)

## GOOD: both real scenarios untouched

status `OFFLINE_STRUCTURAL_PASS`, passed `True`

- `scenario-2`: **READY**, shape {'citizens': 2, 'attempts': 6, 'observations': 6}, exit codes {'consistent': 0, 'missingRoot': 2, 'missingJournal': 2, 'missingReceipt': 2, 'forged': 1, 'forgedReceipt': 1, 'forgedJournal': 1}, forged-receipt rejected=True, rehashed forged-journal rejected=True
- `scenario-4`: **READY**, shape {'citizens': 4, 'attempts': 12, 'observations': 12}, exit codes {'consistent': 0, 'missingRoot': 2, 'missingJournal': 2, 'missingReceipt': 2, 'forged': 1, 'forgedReceipt': 1, 'forgedJournal': 1}, forged-receipt rejected=True, rehashed forged-journal rejected=True

## NEG: 1v1 receipt forged and re-pinned; 2v2 untouched

status `CONTRADICTORY_EVIDENCE_REJECTED`, passed `False`

- `scenario-2`: **FAILED**, shape {'citizens': 2, 'attempts': 6, 'observations': 6}, exit codes {'consistent': 1, 'missingRoot': 1, 'missingJournal': 1, 'missingReceipt': 1, 'forged': 1, 'forgedReceipt': 1, 'forgedJournal': 1}, forged-receipt rejected=True, rehashed forged-journal rejected=True
- `scenario-4`: **READY**, shape {'citizens': 4, 'attempts': 12, 'observations': 12}, exit codes {'consistent': 0, 'missingRoot': 2, 'missingJournal': 2, 'missingReceipt': 2, 'forged': 1, 'forgedReceipt': 1, 'forgedJournal': 1}, forged-receipt rejected=True, rehashed forged-journal rejected=True

## NEG: 1v1 untouched; 2v2 receipt forged and re-pinned

status `CONTRADICTORY_EVIDENCE_REJECTED`, passed `False`

- `scenario-2`: **READY**, shape {'citizens': 2, 'attempts': 6, 'observations': 6}, exit codes {'consistent': 0, 'missingRoot': 2, 'missingJournal': 2, 'missingReceipt': 2, 'forged': 1, 'forgedReceipt': 1, 'forgedJournal': 1}, forged-receipt rejected=True, rehashed forged-journal rejected=True
- `scenario-4`: **FAILED**, shape {'citizens': 4, 'attempts': 12, 'observations': 12}, exit codes {'consistent': 1, 'missingRoot': 1, 'missingJournal': 1, 'missingReceipt': 1, 'forged': 1, 'forgedReceipt': 1, 'forgedJournal': 1}, forged-receipt rejected=True, rehashed forged-journal rejected=True

## NEG: 2v2 evidence directory missing

status `VERIFICATION_INCOMPLETE`, passed `False`

- `scenario-2`: **READY**, shape {'citizens': 2, 'attempts': 6, 'observations': 6}, exit codes {'consistent': 0, 'missingRoot': 2, 'missingJournal': 2, 'missingReceipt': 2, 'forged': 1, 'forgedReceipt': 1, 'forgedJournal': 1}, forged-receipt rejected=True, rehashed forged-journal rejected=True
- `scenario-4`: **FAILED**, shape None, exit codes None, forged-receipt rejected=False, rehashed forged-journal rejected=None

