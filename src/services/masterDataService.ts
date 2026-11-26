import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { formatDatabaseError } from '@/lib/pgErrorHelpers';
import { sortMasterDataBundle } from '@/lib/masterDataSort';
import type {
  LookupCategoryRow,
  LookupItemRow,
  OrgUnitLevelRow,
  OrgUnitRow,
  PositionAllowedLevelRow,
  PositionLevelRow,
  PositionRow,
  PositionTypeRow,
} from '@/types/database.types';
import type { MasterDataBundle } from '@/types/domain.types';

export const EMPTY_MASTER_DATA: MasterDataBundle = {
  categories: [],
  items: [],
  itemsByCategoryCode: {},
  orgUnitLevels: [],
  orgUnits: [],
  positionTypes: [],
  positions: [],
  positionLevels: [],
  positionAllowedLevels: [],
};

function emptyToNull(val: string | null | undefined): string | null {
  const s = String(val ?? '').trim();
  return s ? s : null;
}

export type SortableMasterTable =
  | 'lookup_categories'
  | 'lookup_items'
  | 'org_units'
  | 'position_types'
  | 'positions'
  | 'position_levels';

export const masterDataService = {
  async fetchAll(): Promise<MasterDataBundle> {
    if (!isSupabaseConfigured) return EMPTY_MASTER_DATA;
    const [cats, items, levels, units, pTypes, positions, pLevels, allowed] = await Promise.all([
      supabase.from('lookup_categories').select('*').order('sort_order').order('name_th'),
      supabase.from('lookup_items').select('*').order('sort_order').order('rank_order').order('name_th'),
      supabase.from('org_unit_levels').select('*').order('level_no'),
      supabase.from('org_units').select('*').order('sort_order').order('name_th'),
      supabase.from('position_types').select('*').order('sort_order').order('name_th'),
      supabase.from('positions').select('*').order('sort_order').order('name_th'),
      supabase.from('position_levels').select('*').order('sort_order').order('rank_order'),
      supabase.from('position_allowed_levels').select('*'),
    ]);

    const firstErr =
      cats.error ||
      items.error ||
      levels.error ||
      units.error ||
      pTypes.error ||
      positions.error ||
      pLevels.error ||
      allowed.error;
    if (firstErr) {
      throw new Error(formatDatabaseError(firstErr, 'ไม่สามารถโหลดข้อมูล Master Data ได้'));
    }

    const categories = (cats.data ?? []) as LookupCategoryRow[];
    const lookupItems = (items.data ?? []) as LookupItemRow[];
    const orgUnitLevels = (levels.data ?? []) as OrgUnitLevelRow[];
    const levelMap = new Map(orgUnitLevels.map((l) => [l.id, l.level_no]));
    const orgUnits = ((units.data ?? []) as OrgUnitRow[]).map((u) => ({
      ...u,
      level_no: levelMap.get(u.level_id),
    }));

    const catCodeById = new Map(categories.map((c) => [c.id, c.code]));
    const itemsByCategoryCode: Record<string, LookupItemRow[]> = {};
    for (const item of lookupItems) {
      const code = catCodeById.get(item.category_id);
      if (!code) continue;
      if (!itemsByCategoryCode[code]) itemsByCategoryCode[code] = [];
      itemsByCategoryCode[code].push(item);
    }

    return sortMasterDataBundle({
      categories,
      items: lookupItems,
      itemsByCategoryCode,
      orgUnitLevels,
      orgUnits,
      positionTypes: (pTypes.data ?? []) as PositionTypeRow[],
      positions: (positions.data ?? []) as PositionRow[],
      positionLevels: (pLevels.data ?? []) as PositionLevelRow[],
      positionAllowedLevels: (allowed.data ?? []) as PositionAllowedLevelRow[],
    });
  },

  // ---- Lookup Categories ----
  async saveLookupCategory(payload: Partial<LookupCategoryRow>) {
    const clean = {
      code: String(payload.code || '').trim().toUpperCase(),
      name_th: String(payload.name_th || '').trim(),
      description: emptyToNull(payload.description),
      has_provision_flag: Boolean(payload.has_provision_flag),
      has_approver_flag: Boolean(payload.has_approver_flag),
      sort_order: Number(payload.sort_order ?? 0),
      is_active: payload.is_active !== false,
    };
    const { error } = payload.id
      ? await supabase.from('lookup_categories').update(clean).eq('id', payload.id)
      : await supabase.from('lookup_categories').insert({ ...clean, is_system_locked: false });
    if (error) throw new Error(formatDatabaseError(error));
  },

  async deleteLookupCategory(id: string) {
    const { error } = await supabase.from('lookup_categories').delete().eq('id', id);
    if (error) throw new Error(formatDatabaseError(error));
  },

  // ---- Lookup Items ----
  async saveLookupItem(payload: Partial<LookupItemRow>) {
    const categoryId = emptyToNull(payload.category_id);
    if (!categoryId) throw new Error('กรุณาเลือกหมวดหมู่ตัวเลือก');

    if (payload.is_default) {
      const { error: resetErr } = await supabase
        .from('lookup_items')
        .update({ is_default: false })
        .eq('category_id', categoryId);
      if (resetErr) throw new Error(formatDatabaseError(resetErr));
    }

    const clean = {
      category_id: categoryId,
      code: String(payload.code || '').trim().toUpperCase(),
      name_th: String(payload.name_th || '').trim(),
      short_name: emptyToNull(payload.short_name),
      color_hex: emptyToNull(payload.color_hex),
      rank_order: Number(payload.rank_order ?? 0),
      is_default: Boolean(payload.is_default),
      allows_account_provision: payload.allows_account_provision !== false,
      is_approver: Boolean(payload.is_approver),
      sort_order: Number(payload.sort_order ?? 0),
      is_active: payload.is_active !== false,
    };
    const { error } = payload.id
      ? await supabase.from('lookup_items').update(clean).eq('id', payload.id)
      : await supabase.from('lookup_items').insert(clean);
    if (error) throw new Error(formatDatabaseError(error));
  },

  async saveLookupItemsBatch(rows: Array<Partial<LookupItemRow>>) {
    const prepared = rows
      .filter((r) => String(r.name_th || '').trim() && String(r.code || '').trim() && r.category_id)
      .map((r, idx) => ({
        category_id: String(r.category_id),
        code: String(r.code || '').trim().toUpperCase(),
        name_th: String(r.name_th || '').trim(),
        short_name: emptyToNull(r.short_name),
        color_hex: emptyToNull(r.color_hex),
        rank_order: Number(r.rank_order ?? 0),
        is_default: false,
        allows_account_provision: r.allows_account_provision !== false,
        is_approver: Boolean(r.is_approver),
        sort_order: Number(r.sort_order ?? idx + 1),
        is_active: true,
      }));
    if (prepared.length === 0) throw new Error('กรุณากรอกข้อมูลอย่างน้อย 1 รายการ');
    const { error } = await supabase.from('lookup_items').insert(prepared);
    if (error) throw new Error(formatDatabaseError(error));
  },

  async setDefaultLookupItem(categoryId: string, itemId: string) {
    const { error: e1 } = await supabase
      .from('lookup_items')
      .update({ is_default: false })
      .eq('category_id', categoryId);
    if (e1) throw new Error(formatDatabaseError(e1));
    const { error: e2 } = await supabase
      .from('lookup_items')
      .update({ is_default: true })
      .eq('id', itemId);
    if (e2) throw new Error(formatDatabaseError(e2));
  },

  async deleteLookupItem(id: string) {
    const { error } = await supabase.from('lookup_items').delete().eq('id', id);
    if (error) throw new Error(formatDatabaseError(error));
  },

  // ---- Org Units (4 Levels) ----
  async saveOrgUnit(payload: Partial<OrgUnitRow>) {
    const levelId = emptyToNull(payload.level_id);
    if (!levelId) throw new Error('ไม่พบระดับโครงสร้างหน่วยงาน (level_id)');

    const clean = {
      level_id: levelId,
      parent_id: emptyToNull(payload.parent_id),
      code: emptyToNull(payload.code),
      name_th: String(payload.name_th || '').trim(),
      short_name: emptyToNull(payload.short_name),
      sort_order: Number(payload.sort_order ?? 0),
      is_active: payload.is_active !== false,
    };
    const { error } = payload.id
      ? await supabase.from('org_units').update(clean).eq('id', payload.id)
      : await supabase.from('org_units').insert(clean);
    if (error) throw new Error(formatDatabaseError(error));
  },

  async saveOrgUnitsBatch(rows: Array<Partial<OrgUnitRow>>) {
    const prepared = rows
      .filter((r) => String(r.name_th || '').trim() && r.level_id)
      .map((r, idx) => ({
        level_id: String(r.level_id),
        parent_id: emptyToNull(r.parent_id),
        code: emptyToNull(r.code),
        name_th: String(r.name_th || '').trim(),
        short_name: emptyToNull(r.short_name),
        sort_order: Number(r.sort_order ?? idx + 1),
        is_active: true,
      }));
    if (prepared.length === 0) throw new Error('กรุณากรอกชื่อหน่วยงานอย่างน้อย 1 รายการ');
    const { error } = await supabase.from('org_units').insert(prepared);
    if (error) throw new Error(formatDatabaseError(error));
  },

  async deleteOrgUnit(id: string) {
    const { error } = await supabase.from('org_units').delete().eq('id', id);
    if (error) throw new Error(formatDatabaseError(error));
  },

  // ---- Position Types, Positions & Levels ----
  async savePositionType(payload: Partial<PositionTypeRow>) {
    const clean = {
      code: String(payload.code || '').trim().toUpperCase(),
      name_th: String(payload.name_th || '').trim(),
      color_hex: emptyToNull(payload.color_hex) || '#00744B',
      sort_order: Number(payload.sort_order ?? 0),
      is_active: payload.is_active !== false,
    };
    const { error } = payload.id
      ? await supabase.from('position_types').update(clean).eq('id', payload.id)
      : await supabase.from('position_types').insert(clean);
    if (error) throw new Error(formatDatabaseError(error));
  },

  async savePositionTypesBatch(rows: Array<Partial<PositionTypeRow>>) {
    const prepared = rows
      .filter((r) => String(r.name_th || '').trim() && String(r.code || '').trim())
      .map((r, idx) => ({
        code: String(r.code || '').trim().toUpperCase(),
        name_th: String(r.name_th || '').trim(),
        color_hex: emptyToNull(r.color_hex) || '#00744B',
        sort_order: Number(r.sort_order ?? idx + 1),
        is_active: true,
      }));
    if (prepared.length === 0) throw new Error('กรุณากรอกรหัสและชื่อประเภทตำแหน่งอย่างน้อย 1 รายการ');
    const { error } = await supabase.from('position_types').insert(prepared);
    if (error) throw new Error(formatDatabaseError(error));
  },

  async deletePositionType(id: string) {
    const { error } = await supabase.from('position_types').delete().eq('id', id);
    if (error) throw new Error(formatDatabaseError(error));
  },

  async savePosition(payload: Partial<PositionRow>, allowedLevelIds?: string[]) {
    const posTypeId = emptyToNull(payload.position_type_id);
    if (!posTypeId) throw new Error('กรุณาเลือกประเภทตำแหน่ง');

    const clean = {
      position_type_id: posTypeId,
      name_th: String(payload.name_th || '').trim(),
      requires_level: payload.requires_level !== false,
      sort_order: Number(payload.sort_order ?? 0),
      is_active: payload.is_active !== false,
    };

    let posId = payload.id;
    if (posId) {
      const { error } = await supabase.from('positions').update(clean).eq('id', posId);
      if (error) throw new Error(formatDatabaseError(error));
    } else {
      const { data, error } = await supabase.from('positions').insert(clean).select('id').single();
      if (error) throw new Error(formatDatabaseError(error));
      posId = data.id as string;
    }

    if (allowedLevelIds !== undefined && posId) {
      const { error: delErr } = await supabase
        .from('position_allowed_levels')
        .delete()
        .eq('position_id', posId);
      if (delErr) throw new Error(formatDatabaseError(delErr));

      if (clean.requires_level && allowedLevelIds.length > 0) {
        const rows = Array.from(new Set(allowedLevelIds)).map((lid) => ({
          position_id: posId!,
          position_level_id: lid,
        }));
        const { error: insErr } = await supabase.from('position_allowed_levels').insert(rows);
        if (insErr) throw new Error(formatDatabaseError(insErr));
      }
    }
  },

  async savePositionsBatch(
    rows: Array<{ position_type_id: string; name_th: string; requires_level: boolean; sort_order: number }>,
    allowedLevelIds: string[]
  ) {
    const valid = rows.filter((r) => r.position_type_id && r.name_th.trim());
    if (valid.length === 0) throw new Error('กรุณากรอกชื่อตำแหน่งอย่างน้อย 1 รายการ');

    const { data, error } = await supabase
      .from('positions')
      .insert(
        valid.map((r) => ({
          position_type_id: r.position_type_id,
          name_th: r.name_th.trim(),
          requires_level: r.requires_level,
          sort_order: r.sort_order,
          is_active: true,
        }))
      )
      .select('id, requires_level');
    if (error) throw new Error(formatDatabaseError(error));

    const inserted = (data ?? []) as Array<{ id: string; requires_level: boolean }>;
    const uniqueLevels = Array.from(new Set(allowedLevelIds));
    if (uniqueLevels.length > 0) {
      const links: Array<{ position_id: string; position_level_id: string }> = [];
      for (const p of inserted) {
        if (p.requires_level) {
          for (const lid of uniqueLevels) {
            links.push({ position_id: p.id, position_level_id: lid });
          }
        }
      }
      if (links.length > 0) {
        const { error: linkErr } = await supabase.from('position_allowed_levels').insert(links);
        if (linkErr) throw new Error(formatDatabaseError(linkErr));
      }
    }
  },

  async deletePosition(id: string) {
    const { error } = await supabase.from('positions').delete().eq('id', id);
    if (error) throw new Error(formatDatabaseError(error));
  },

  async savePositionLevel(payload: Partial<PositionLevelRow>) {
    const clean = {
      code: String(payload.code || '').trim().toUpperCase(),
      name_th: String(payload.name_th || '').trim(),
      rank_order: Number(payload.rank_order ?? 0),
      sort_order: Number(payload.sort_order ?? 0),
      is_active: payload.is_active !== false,
    };
    const { error } = payload.id
      ? await supabase.from('position_levels').update(clean).eq('id', payload.id)
      : await supabase.from('position_levels').insert(clean);
    if (error) throw new Error(formatDatabaseError(error));
  },

  async savePositionLevelsBatch(rows: Array<Partial<PositionLevelRow>>) {
    const prepared = rows
      .filter((r) => String(r.name_th || '').trim() && String(r.code || '').trim())
      .map((r, idx) => ({
        code: String(r.code || '').trim().toUpperCase(),
        name_th: String(r.name_th || '').trim(),
        rank_order: Number(r.rank_order ?? (idx + 1) * 10),
        sort_order: Number(r.sort_order ?? idx + 1),
        is_active: true,
      }));
    if (prepared.length === 0) throw new Error('กรุณากรอกรหัสและชื่อระดับตำแหน่งอย่างน้อย 1 รายการ');
    const { error } = await supabase.from('position_levels').insert(prepared);
    if (error) throw new Error(formatDatabaseError(error));
  },

  async deletePositionLevel(id: string) {
    const { error } = await supabase.from('position_levels').delete().eq('id', id);
    if (error) throw new Error(formatDatabaseError(error));
  },

  // ---- Sort Order Reorder / Swap & Toggle Active ----
  async reorderSortOrder(table: SortableMasterTable, orderedIds: string[]) {
    if (orderedIds.length === 0) return;
    const results = await Promise.all(
      orderedIds.map((id, idx) =>
        supabase.from(table).update({ sort_order: idx + 1 }).eq('id', id)
      )
    );
    const err = results.find((r) => r.error)?.error;
    if (err) throw new Error(formatDatabaseError(err));
  },

  async swapSortOrder(
    table: SortableMasterTable,
    itemA: { id: string; sort_order: number },
    itemB: { id: string; sort_order: number }
  ) {
    const orderA = itemA.sort_order === itemB.sort_order ? itemA.sort_order + 1 : itemB.sort_order;
    const orderB = itemA.sort_order;
    const [r1, r2] = await Promise.all([
      supabase.from(table).update({ sort_order: orderA }).eq('id', itemA.id),
      supabase.from(table).update({ sort_order: orderB }).eq('id', itemB.id),
    ]);
    const err = r1.error || r2.error;
    if (err) throw new Error(formatDatabaseError(err));
  },

  async toggleActive(table: SortableMasterTable, id: string, isActive: boolean) {
    const { error } = await supabase.from(table).update({ is_active: isActive }).eq('id', id);
    if (error) throw new Error(formatDatabaseError(error));
  },
};
