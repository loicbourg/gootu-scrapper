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
  tarif_ttc1?: number;
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
  snacking?: MenuPlat[];
  plats: MenuPlat[];
  suggestions: MenuPlat[];
  desserts: string[];
}

export interface MenuPlat {
  nom: string;
  hasGoatOrSheepCheese: boolean;
  isFallback?: boolean;
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

  if (slug === 'suggestions') {
    return ['suggestion', 'suggestions'];
  }

  if (slug === 'snacking') {
    return ['snacking'];
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

function isActiveSnackingItem(item: CatalogItem, targetDate: string | undefined): boolean {
  const endDate = extractDatePrefix(item.fin);
  if (!endDate || !targetDate) {
    return true;
  }

  return endDate === targetDate;
}

function isActiveForTargetDate(item: CatalogItem, targetDate: string | undefined): boolean {
  const endDate = extractDatePrefix(item.fin);
  if (!endDate || !targetDate) {
    return true;
  }

  return endDate === targetDate;
}

function normalizeForContains(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const GOAT_OR_SHEEP_SPECIALTIES = [
  'chevre',
  'brebis',
  'roquefort',
  'feta',
  'pecorino',
  'ossau',
  'iraty',
  'manchego',
  'brocciu',
  'cabecou',
  'chabichou',
  'picodon',
  'crottin',
  'valencay',
  'sainte maure',
  'banon',
  'pouligny',
  'brousse'
].map(normalizeForContains);

function containsGoatOrSheepCheese(platName: string): boolean {
  const normalized = normalizeForContains(platName);
  return GOAT_OR_SHEEP_SPECIALTIES.some((keyword) => normalized.includes(keyword));
}

interface CandidatePlat extends MenuPlat {
  explicitSuggestion: boolean;
  price?: number;
}

const SUGGESTION_PRICE_DELTA = 2;
const UNIFORM_SUGGESTION_MIN_PRICE = 13;

function toMenuPlat(candidate: CandidatePlat): MenuPlat {
  const plat: MenuPlat = {
    nom: candidate.nom,
    hasGoatOrSheepCheese: candidate.hasGoatOrSheepCheese
  };

  if (candidate.isFallback) {
    plat.isFallback = true;
  }

  return plat;
}

function splitPlatsAndSuggestions(candidates: CandidatePlat[]): { plats: MenuPlat[]; suggestions: MenuPlat[] } {
  const suggestionByPrice = new Set<string>();
  const nonExplicit = candidates.filter((candidate) => !candidate.explicitSuggestion);
  const nonExplicitWithPrice = nonExplicit.filter((candidate) => Number.isFinite(candidate.price));

  if (nonExplicitWithPrice.length > 0) {
    const prices = nonExplicitWithPrice.map((candidate) => candidate.price as number);
    const roundedUniquePrices = new Set(prices.map((price) => Number(price.toFixed(2))));

    if (roundedUniquePrices.size === 1) {
      const uniformPrice = prices[0];
      if (uniformPrice > UNIFORM_SUGGESTION_MIN_PRICE) {
        for (const candidate of nonExplicitWithPrice) {
          suggestionByPrice.add(candidate.nom);
        }
      }
    } else {
      const basePlatPrice = Math.min(...prices);
      for (const candidate of nonExplicitWithPrice) {
        if ((candidate.price as number) - basePlatPrice >= SUGGESTION_PRICE_DELTA) {
          suggestionByPrice.add(candidate.nom);
        }
      }
    }
  }

  const plats: MenuPlat[] = [];
  const suggestions: MenuPlat[] = [];

  for (const candidate of candidates) {
    if (candidate.explicitSuggestion || suggestionByPrice.has(candidate.nom)) {
      suggestions.push(toMenuPlat(candidate));
      continue;
    }

    plats.push(toMenuPlat(candidate));
  }

  return { plats, suggestions };
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
  const suggestionAliases = new Set(categoryAliases('suggestions'));
  const snackingAliases = new Set(categoryAliases('snacking'));
  const dessertAliases = new Set(categoryAliases('desserts'));

  const platsCandidates: CandidatePlat[] = [];
  const snacking: MenuPlat[] = [];
  const desserts: string[] = [];

  for (const item of catalog) {
    const rawCategories = item.categories ?? [];
    const resolved = rawCategories.map((name) => categoryIndex.get(slugify(name)) ?? slugify(name));
    const isPlatCategory = resolved.some((category) => platAliases.has(category));
    const isSuggestionCategory = resolved.some((category) => suggestionAliases.has(category));
    const isSnackingCategory = resolved.some((category) => snackingAliases.has(category));
    const isCandidateSavoryItem = isPlatCategory || isSuggestionCategory || isSnackingCategory;

    if (isCandidateSavoryItem && !isActiveForTargetDate(item, targetDate)) {
      continue;
    }

    if (isSnackingCategory && isActiveSnackingItem(item, targetDate) && !snacking.some((plat) => plat.nom === item.nom)) {
      snacking.push({
        nom: item.nom,
        hasGoatOrSheepCheese: containsGoatOrSheepCheese(item.nom)
      });
      continue;
    }

    if ((isPlatCategory || isSuggestionCategory) && !platsCandidates.some((plat) => plat.nom === item.nom)) {
      platsCandidates.push({
        nom: item.nom,
        hasGoatOrSheepCheese: containsGoatOrSheepCheese(item.nom),
        explicitSuggestion: isSuggestionCategory,
        price: Number.isFinite(item.tarif_ttc1) ? item.tarif_ttc1 : undefined
      });
      continue;
    }

    if (resolved.some((category) => dessertAliases.has(category)) && !desserts.includes(item.nom)) {
      desserts.push(item.nom);
    }
  }

  const { plats, suggestions } = splitPlatsAndSuggestions(platsCandidates);
  return { snacking, plats, suggestions, desserts };
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
  const snacking = [...(sections.snacking ?? [])];
  const plats = [...sections.plats];
  const suggestions = [...(sections.suggestions ?? [])];
  const desserts = [...sections.desserts];

  if (isOpenDay && plats.length === 0 && hasPlatFilter(menuDetail)) {
    plats.push({
      nom: 'Plat du jour (detail non expose par l API)',
      hasGoatOrSheepCheese: false,
      isFallback: true
    });
  }

  return { snacking, plats, suggestions, desserts };
}

export function shouldPostMenu(sections: MenuSections, isOpenDay: boolean = true): boolean {
  const hasPlat = sections.plats.some((plat) => !plat.isFallback);
  const hasSuggestion = (sections.suggestions ?? []).length > 0;
  return isOpenDay && (hasPlat || hasSuggestion);
}

function formatHumanDate(date: Date): string {
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit'
  });
}

export function buildSlackMessage(date: Date, sections: MenuSections): string {
  const snacking = sections.snacking ?? [];
  const suggestions = sections.suggestions ?? [];
  const hasGoatPlat = [...snacking, ...sections.plats, ...suggestions].some((plat) => plat.hasGoatOrSheepCheese);
  const lines: string[] = [];
  lines.push(`${hasGoatPlat ? ':goat_dead:' : '🍽️'} Menu du jour GOOTU - ${formatHumanDate(date)}`);

  if (snacking.length > 0) {
    lines.push('');
    lines.push('Snacking:');
    for (const item of snacking) {
      lines.push(`- ${item.hasGoatOrSheepCheese ? ':goat_dead: ' : ''}${item.nom}`);
    }
  }

  lines.push('');
  lines.push('Plats du jour:');

  for (const plat of sections.plats) {
    lines.push(`- ${plat.hasGoatOrSheepCheese ? ':goat_dead: ' : ''}${plat.nom}`);
  }

  if (suggestions.length > 0) {
    lines.push('');
    lines.push('Suggestions:');
    for (const suggestion of suggestions) {
      lines.push(`- ${suggestion.hasGoatOrSheepCheese ? ':goat_dead: ' : ''}${suggestion.nom}`);
    }
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
