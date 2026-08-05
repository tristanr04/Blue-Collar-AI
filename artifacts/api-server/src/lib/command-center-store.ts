import crypto from "node:crypto";

export type SqlExecutor = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;

export type SnapshotInput = {
  cash?: number; monthlyTakeHome?: number; monthlyExpenses?: number; totalDebt?: number;
  highInterestDebt?: number; investments?: number; retirement?: number;
  creditUtilization?: number; healthScore?: number; netWorth?: number;
  source?: string; metadata?: Record<string, unknown>;
};

export type MemoryInput = {
  id?: string;
  type: "goal" | "commitment" | "life_event" | "preference" | "milestone";
  title: string;
  detail?: string | null;
  status?: "active" | "completed" | "dismissed" | "paused";
  currentValue?: number | null;
  targetValue?: number | null;
  unit?: string | null;
  dueDate?: string | null;
  sourceDocumentId?: string | null;
  metadata?: Record<string, unknown>;
};

const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;

export function authenticatedUserId(req: unknown): string | null {
  const request = req as { auth?: { userId?: string | null }; user?: { id?: string | null } };
  return request.auth?.userId ?? request.user?.id ?? null;
}

export class CommandCenterStore {
  constructor(private readonly query: SqlExecutor) {}

  async saveSnapshot(userId: string, input: SnapshotInput) {
    const result = await this.query(
      `INSERT INTO financial_snapshots
       (clerk_user_id, source, cash, monthly_take_home, monthly_expenses, total_debt,
        high_interest_debt, investments, retirement, credit_utilization, health_score, net_worth, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
       RETURNING *`,
      [userId, input.source ?? "command_center", finite(input.cash), finite(input.monthlyTakeHome),
       finite(input.monthlyExpenses), finite(input.totalDebt), finite(input.highInterestDebt),
       finite(input.investments), finite(input.retirement), finite(input.creditUtilization),
       input.healthScore ?? null, input.netWorth ?? null, JSON.stringify(input.metadata ?? {})]
    );
    return result.rows[0];
  }

  async listSnapshots(userId: string, limit = 24) {
    const safeLimit = Math.min(120, Math.max(2, Math.trunc(limit)));
    return (await this.query(
      `SELECT * FROM financial_snapshots WHERE clerk_user_id=$1
       ORDER BY captured_at DESC LIMIT $2`, [userId, safeLimit]
    )).rows;
  }

  async upsertMemory(userId: string, memory: MemoryInput) {
    if (!memory.title?.trim()) throw new Error("Memory title is required.");
    const id = memory.id ?? crypto.randomUUID();
    const result = await this.query(
      `INSERT INTO financial_memory_records
       (id, clerk_user_id, memory_type, title, detail, status, current_value, target_value,
        unit, due_date, source_document_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
       ON CONFLICT (clerk_user_id, memory_type, lower(title))
       WHERE status IN ('active','paused')
       DO UPDATE SET detail=EXCLUDED.detail, status=EXCLUDED.status,
         current_value=EXCLUDED.current_value, target_value=EXCLUDED.target_value,
         unit=EXCLUDED.unit, due_date=EXCLUDED.due_date,
         source_document_id=EXCLUDED.source_document_id, metadata=EXCLUDED.metadata,
         updated_at=now()
       RETURNING *`,
      [id, userId, memory.type, memory.title.trim(), memory.detail ?? null, memory.status ?? "active",
       memory.currentValue ?? null, memory.targetValue ?? null, memory.unit ?? null,
       memory.dueDate ?? null, memory.sourceDocumentId ?? null, JSON.stringify(memory.metadata ?? {})]
    );
    return result.rows[0];
  }

  async listMemory(userId: string, status = "active") {
    return (await this.query(
      `SELECT * FROM financial_memory_records WHERE clerk_user_id=$1 AND status=$2
       ORDER BY updated_at DESC`, [userId, status]
    )).rows;
  }

  async saveWin(userId: string, input: { type: string; title: string; detail?: string; amount?: number; occurredAt?: string }) {
    const fingerprint = crypto.createHash("sha256")
      .update([input.type, input.title, input.amount ?? "", input.occurredAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)].join("|"))
      .digest("hex");
    const result = await this.query(
      `INSERT INTO financial_wins
       (clerk_user_id, win_type, title, detail, amount, occurred_at, fingerprint)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz,now()),$7)
       ON CONFLICT (clerk_user_id, fingerprint) DO NOTHING RETURNING *`,
      [userId, input.type, input.title, input.detail ?? null, input.amount ?? null, input.occurredAt ?? null, fingerprint]
    );
    return result.rows[0] ?? null;
  }
}
