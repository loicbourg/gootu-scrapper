const API_BASE_URL = 'https://api.gootu.fr';

export interface Category {
  nom: string;
  slug: string;
}

export interface CatalogItem {
  nom: string;
  categories?: string[];
  en_avant?: boolean;
  fin?: string;
}

export interface MenuSummary {
  nom: string;
  slug: string;
}

export interface MenuDetail {
  nom: string;
  slug: string;
  description?: string;
  filtre_categories?: Array<{ id: number; nom: string; position: number | null }>;
}

export interface MenuSections {
  plats: string[];
  desserts: string[];
}

export interface GootuApiData {
  targetDate: string;
  categories: Category[];
  catalog: CatalogItem[];
  menus: MenuSummary[];
  menuDetail: MenuDetail | null;
  sections: MenuSections;
  isOpenDay: boolean;
}

interface CreneauxResponse {
  jours?: Array<{
    jour: number;
    creneaux: unknown[];
  }>;
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function categoryAliases(slug: string): string[] {
  if (slug === 'plats-du-jour') {
    return ['plat-du-jour', 'plats-du-jour'];
  }

  if (slug === 'desserts') {
    return ['dessert', 'desserts'];
  }

  return [slug];
}

export function formatApiDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function extractDatePrefix(value?: string): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function isEligibleSnackingPlatName(name: string): boolean {
  const normalized = slugify(name);
  return !['burger', 'wrap', 'sandwich'].some((excluded) => normalized.includes(excluded));
}

function shouldPromoteSnackingToPlat(
  item: CatalogItem,
  resolvedCategories: string[],
  targetDate: string | undefined
): boolean {
  if (!targetDate) {
    return false;
  }

  if (!resolvedCategories.includes('snacking')) {
    return false;
  }

  if (!item.en_avant || !isEligibleSnackingPlatName(item.nom)) {
    return false;
  }

  return extractDatePrefix(item.fin) === targetDate;
}

export function extractMenuSections(
  catalog: CatalogItem[],
  categories: Category[],
  targetDate?: string
): MenuSections {
  const categoryIndex = new Map<string, string>();

  for (const category of categories) {
    const canonicalSlug = slugify(category.slug || category.nom);
    categoryIndex.set(slugify(category.nom), canonicalSlug);
    categoryIndex.set(slugify(category.slug), canonicalSlug);
  }

  const platAliases = new Set(categoryAliases('plats-du-jour'));
  const dessertAliases = new Set(categoryAliases('desserts'));

  const plats: string[] = [];
  const desserts: string[] = [];

  for (const item of catalog) {
    const rawCategories = item.categories ?? [];
    const resolved = rawCategories.map((name) => categoryIndex.get(slugify(name)) ?? slugify(name));
    const isPlatCategory = resolved.some((category) => platAliases.has(category));
    const isPromotedSnackingPlat = shouldPromoteSnackingToPlat(item, resolved, targetDate);

    if ((isPlatCategory || isPromotedSnackingPlat) && !plats.includes(item.nom)) {
      plats.push(item.nom);
      continue;
    }

    if (resolved.some((category) => dessertAliases.has(category)) && !desserts.includes(item.nom)) {
      desserts.push(item.nom);
    }
  }

  return { plats, desserts };
}

export function isOpenOnTargetDate(targetDate: Date, creneaux: CreneauxResponse): boolean {
  const day = targetDate.getDay();
  const slot = (creneaux.jours ?? []).find((entry) => entry.jour === day);
  return !!slot && Array.isArray(slot.creneaux) && slot.creneaux.length > 0;
}

function hasPlatFilter(menuDetail: MenuDetail | null): boolean {
  return !!menuDetail?.filtre_categories?.some((filter) => slugify(filter.nom).includes('plat-du-jour'));
}

export function finalizeMenuSections(
  sections: MenuSections,
  menuDetail: MenuDetail | null,
  isOpenDay: boolean
): MenuSections {
  const plats = [...sections.plats];
  const desserts = [...sections.desserts];

  if (isOpenDay && plats.length === 0 && hasPlatFilter(menuDetail)) {
    plats.push('Plat du jour (detail non expose par l API)');
  }

  return { plats, desserts };
}

export function shouldPostMenu(sections: MenuSections, isOpenDay: boolean = true): boolean {
  return isOpenDay && sections.plats.length > 0;
}

function formatHumanDate(date: Date): string {
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit'
  });
}

export function buildSlackMessage(date: Date, sections: MenuSections): string {
  const lines: string[] = [];
  lines.push(`🍽️ Menu du jour GOOTU - ${formatHumanDate(date)}`);
  lines.push('');
  lines.push('Plats du jour:');

  for (const plat of sections.plats) {
    lines.push(`- ${plat}`);
  }

  if (sections.desserts.length > 0) {
    lines.push('');
    lines.push('Desserts:');
    for (const dessert of sections.desserts) {
      lines.push(`- ${dessert}`);
    }
  }

  return lines.join('\n');
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json, text/plain, */*'
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function selectDailyMenuSlug(menus: MenuSummary[]): string | null {
  const preferred = menus.find((menu) => menu.slug === 'menu-plat-du-jour');
  if (preferred) {
    return preferred.slug;
  }

  const fallback = menus.find((menu) => slugify(menu.nom).includes('plat-du-jour'));
  return fallback ? fallback.slug : null;
}

export async function loadGootuApiData(targetDate: Date): Promise<GootuApiData> {
  const dateKey = formatApiDate(targetDate);

  const [categories, catalogResponse, menus, creneaux] = await Promise.all([
    fetchJson<Category[]>(`${API_BASE_URL}/categories`),
    fetchJson<{ catalog: CatalogItem[] }>(`${API_BASE_URL}/catalog`),
    fetchJson<MenuSummary[]>(`${API_BASE_URL}/menus/${dateKey}`),
    fetchJson<CreneauxResponse>(`${API_BASE_URL}/creneaux`)
  ]);

  const menuSlug = selectDailyMenuSlug(menus);
  const menuDetail = menuSlug
    ? await fetchJson<MenuDetail>(`${API_BASE_URL}/menu/${dateKey}/${menuSlug}`)
    : null;

  const sections = finalizeMenuSections(
    extractMenuSections(catalogResponse.catalog, categories, dateKey),
    menuDetail,
    isOpenOnTargetDate(targetDate, creneaux)
  );

  return {
    targetDate: dateKey,
    categories,
    catalog: catalogResponse.catalog,
    menus,
    menuDetail,
    sections,
    isOpenDay: isOpenOnTargetDate(targetDate, creneaux)
  };
}
