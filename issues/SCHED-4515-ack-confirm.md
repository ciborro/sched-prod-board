---
id: SCHED-4515
title: Ack asks to confirm, naming the incident id
status: ready
plan: R2
---

Follow-up to SCHED-4511. The step-1 recording (00:24) shows the pointer resting on INC-4724's Ack while a
refresh put a new incident at the top; the click acked INC-4446 (sev1) instead.

Product's decision (2026-11-12): "New incidents stay live at the top and Ack stays on the row, but Ack asks
to confirm, and the confirm names the incident id."

- Ack opens a confirm (`data-testid="confirm"`) that names the incident id of the row that was clicked.
- Its Ack button (`data-testid="confirm-ack"`) sends `api.ack(id)` and marks that row acked.
- Cancel (`data-testid="confirm-cancel"`) or Escape closes it and sends nothing.
- R1 and R4 stay as they are: new incidents still appear live at the top.

Acceptance: a click on any row's Ack shows a confirm with that row's id; nothing is acked until the confirm's
Ack; Cancel acks nothing.
