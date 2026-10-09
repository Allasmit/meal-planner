import type { Response } from 'express';
import { createRouter } from '../lib/router';
import { parseId } from '../lib/params';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { familyMembers, familyMemberDietaryTypes, dietaryTypes } from '../db/schema';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { z } from 'zod';

export const familyRouter = createRouter();
familyRouter.use(requireAuth);

const memberSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.enum(['Adult', 'Teen', 'Child']).default('Adult'),
  notes: z.string().optional().nullable(),
  dietaryTypeIds: z.array(z.number().int()).default([]),
});

// ─── GET /api/family ──────────────────────────────────────────────────────────

async function loadMembers(onlyId?: number) {
  const members = onlyId === undefined
    ? await db.select().from(familyMembers)
    : await db.select().from(familyMembers).where(eq(familyMembers.id, onlyId));
  if (members.length === 0) return [];

  const memberIds = members.map((m) => m.id);
  const dietaryRows = await db
    .select({
      familyMemberId: familyMemberDietaryTypes.familyMemberId,
      id: dietaryTypes.id,
      name: dietaryTypes.name,
      icon: dietaryTypes.icon,
    })
    .from(familyMemberDietaryTypes)
    .innerJoin(dietaryTypes, eq(familyMemberDietaryTypes.dietaryTypeId, dietaryTypes.id))
    .where(inArray(familyMemberDietaryTypes.familyMemberId, memberIds));

  return members.map((m) => ({
    ...m,
    dietaryTypes: dietaryRows
      .filter((r) => r.familyMemberId === m.id)
      .map(({ id, name, icon }) => ({ id, name, icon })),
  }));
}

familyRouter.get('/', async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json(await loadMembers());
});

// ─── POST /api/family ─────────────────────────────────────────────────────────

familyRouter.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = memberSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { dietaryTypeIds, ...memberData } = parsed.data;
  const memberId = await db.transaction(async (tx) => {
    const [member] = await tx.insert(familyMembers).values(memberData).returning({ id: familyMembers.id });
    const unique = [...new Set(dietaryTypeIds)];
    if (unique.length > 0) {
      await tx.insert(familyMemberDietaryTypes).values(
        unique.map((dietaryTypeId) => ({ familyMemberId: member.id, dietaryTypeId })),
      );
    }
    return member.id;
  });

  const [created] = await loadMembers(memberId);
  res.status(201).json(created);
});

// ─── PATCH /api/family/:id ────────────────────────────────────────────────────

familyRouter.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const parsed = memberSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { dietaryTypeIds, ...memberData } = parsed.data;
  const found = await db.transaction(async (tx) => {
    const [updated] = await tx.update(familyMembers).set(memberData).where(eq(familyMembers.id, id)).returning({ id: familyMembers.id });
    if (!updated) return false;

    await tx.delete(familyMemberDietaryTypes).where(eq(familyMemberDietaryTypes.familyMemberId, id));
    const unique = [...new Set(dietaryTypeIds)];
    if (unique.length > 0) {
      await tx.insert(familyMemberDietaryTypes).values(
        unique.map((dietaryTypeId) => ({ familyMemberId: id, dietaryTypeId })),
      );
    }
    return true;
  });

  if (!found) { res.status(404).json({ error: 'Family member not found' }); return; }
  const [member] = await loadMembers(id);
  res.json(member);
});

// ─── DELETE /api/family/:id ───────────────────────────────────────────────────

familyRouter.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const result = await db.delete(familyMembers).where(eq(familyMembers.id, id)).returning({ id: familyMembers.id });
  if (result.length === 0) { res.status(404).json({ error: 'Family member not found' }); return; }
  res.json({ ok: true });
});
