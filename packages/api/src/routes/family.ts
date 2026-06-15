import { Router, type Response } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { familyMembers, familyMemberDietaryTypes, dietaryTypes } from '../db/schema';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { z } from 'zod';

export const familyRouter = Router();
familyRouter.use(requireAuth);

const memberSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.enum(['Adult', 'Teen', 'Child']).default('Adult'),
  notes: z.string().optional().nullable(),
  dietaryTypeIds: z.array(z.number().int()).default([]),
});

// ─── GET /api/family ──────────────────────────────────────────────────────────

familyRouter.get('/', async (_req: AuthRequest, res: Response): Promise<void> => {
  const members = await db.select().from(familyMembers);
  if (members.length === 0) { res.json([]); return; }

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

  const result = members.map((m) => ({
    ...m,
    dietaryTypes: dietaryRows
      .filter((r) => r.familyMemberId === m.id)
      .map(({ id, name, icon }) => ({ id, name, icon })),
  }));

  res.json(result);
});

// ─── POST /api/family ─────────────────────────────────────────────────────────

familyRouter.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = memberSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { dietaryTypeIds, ...memberData } = parsed.data;
  const [member] = await db.insert(familyMembers).values(memberData).returning();

  if (dietaryTypeIds.length > 0) {
    await db.insert(familyMemberDietaryTypes).values(
      dietaryTypeIds.map((id) => ({ familyMemberId: member.id, dietaryTypeId: id })),
    );
  }

  res.status(201).json({ ...member, dietaryTypes: [] });
});

// ─── PATCH /api/family/:id ────────────────────────────────────────────────────

familyRouter.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const parsed = memberSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { dietaryTypeIds, ...memberData } = parsed.data;

  const [updated] = await db.update(familyMembers).set(memberData).where(eq(familyMembers.id, id)).returning();
  if (!updated) { res.status(404).json({ error: 'Family member not found' }); return; }

  await db.delete(familyMemberDietaryTypes).where(eq(familyMemberDietaryTypes.familyMemberId, id));
  if (dietaryTypeIds.length > 0) {
    await db.insert(familyMemberDietaryTypes).values(
      dietaryTypeIds.map((dtId) => ({ familyMemberId: id, dietaryTypeId: dtId })),
    );
  }

  res.json({ ...updated, dietaryTypeIds });
});

// ─── DELETE /api/family/:id ───────────────────────────────────────────────────

familyRouter.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const result = await db.delete(familyMembers).where(eq(familyMembers.id, id)).returning({ id: familyMembers.id });
  if (result.length === 0) { res.status(404).json({ error: 'Family member not found' }); return; }
  res.json({ ok: true });
});
