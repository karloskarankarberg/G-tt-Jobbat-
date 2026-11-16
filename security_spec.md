# Security Specification & Payload-First Audit

## 1. Data Invariants
1. **Strict Ownership**: Every document in `customers`, `projects`, `taskTypes`, `timeEntries`, and `activeTimers` MUST carry `ownerId == request.auth.uid`, and `request.auth.token.email_verified == true` is required for all writes.
2. **Referential Integrity**:
   - A `Project` cannot be created unless its `customerId` references an existing `Customer` owned by `request.auth.uid`.
   - A `TaskType` with a non-empty `projectId` cannot be created unless that `Project` exists and is owned by `request.auth.uid`.
   - A `TimeEntry` cannot be created unless `customerId` and `projectId` exist and are owned by `request.auth.uid`, and `taskTypeId` (if non-empty) exists and is owned by `request.auth.uid`. Furthermore, the referenced `Project` must belong to `customerId`.
   - An `ActiveTimer` document ID MUST equal `request.auth.uid` and reference valid `customerId` and `projectId` owned by `request.auth.uid`.
3. **Immutability & Temporal Integrity**:
   - `ownerId` and `createdAt` are immutable after creation.
   - `createdAt == request.time` on creation; `updatedAt == request.time` on both creation and update.
4. **Terminal State Locking**:
   - Projects with `status == 'archived'` cannot be modified via standard detail updates unless explicitly restored in the archive/restore action or kept read-only until unarchived (let's explicitly model `UpdateDetails` on active projects vs `Archive`/`Restore` state transition actions).
5. **Query Isolation**:
   - All `list` operations MUST enforce `resource.data.ownerId == request.auth.uid` without calling `get()` or `exists()`.

## 2. The "Dirty Dozen" Adversarial Payloads (Expected: PERMISSION_DENIED)
1. **Identity Spoofing on Customer Create**: `ownerId: "victim-uid"` by attacker -> Denied (`ownerId == request.auth.uid`).
2. **Unverified Email Write**: `request.auth.token.email_verified == false` -> Denied.
3. **Ghost / Shadow Field Injection**: `Customer` payload with extra key `isAdmin: true` -> Denied (`hasOnly`).
4. **Orphaned Project**: `Project` with non-existent `customerId: "fake-cust"` -> Denied (`exists` + owner check).
5. **Cross-Tenant Project Hijack**: `Project` referencing another user's valid `customerId` -> Denied (`get(...).data.ownerId == request.auth.uid`).
6. **ID Poisoning**: Document ID > 128 chars or containing `$` / spaces -> Denied (`isValidId`).
7. **Resource Exhaustion (1MB String)**: `TimeEntry.description` with 5,000 chars -> Denied (`size() <= 500`).
8. **Negative / Excessive Hours**: `TimeEntry.hours: 200` or `-2` -> Denied (`hours > 0 && hours <= 24`).
9. **Client Timestamp Forgery**: `createdAt` set to backdated timestamp instead of `request.time` -> Denied.
10. **Immortal Field Mutation**: Updating `TimeEntry.ownerId` or `TimeEntry.createdAt` -> Denied (`incoming().ownerId == existing().ownerId`, `affectedKeys().hasOnly(...)`).
11. **Project-Customer Mismatch on TimeEntry**: `TimeEntry` pointing to Project A while claiming `customerId` of Customer B -> Denied (`get(project).data.customerId == incoming().customerId`).
12. **Blanket List Scraping**: `list` query on `timeEntries` without `where('ownerId', '==', uid)` -> Denied (`resource.data.ownerId == request.auth.uid`).
