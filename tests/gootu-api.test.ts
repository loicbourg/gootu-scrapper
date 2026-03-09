import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSlackMessage,
  extractMenuSections,
  finalizeMenuSections,
  shouldPostMenu
} from '../gootu-api.ts';

test('extractMenuSections keeps only plat du jour and desserts', () => {
  const categories = [
    { nom: 'Plats du jour', slug: 'plats-du-jour' },
    { nom: 'Desserts', slug: 'desserts' },
    { nom: 'Boissons', slug: 'boissons' },
    { nom: 'Sandwichs', slug: 'sandwichs' }
  ];

  const catalog = [
    { nom: 'Blanquette de veau', categories: ['Plats du jour'] },
    { nom: 'Cookie chocolat', categories: ['desserts'] },
    { nom: 'Burger l\'Ambert', categories: ['sandwichs'] },
    { nom: 'Coca-cola', categories: ['Boissons'] }
  ];

  const sections = extractMenuSections(catalog, categories);

  assert.deepEqual(sections.plats, ['Blanquette de veau']);
  assert.deepEqual(sections.desserts, ['Cookie chocolat']);
});

test('extractMenuSections includes active snacking plat while excluding burger/wrap/sandwich', () => {
  const categories = [
    { nom: 'Plats du jour', slug: 'plats-du-jour' },
    { nom: 'Desserts', slug: 'desserts' },
    { nom: 'Snacking', slug: 'snacking' }
  ];

  const catalog = [
    { nom: 'Effiloche de porc sauce moutarde', categories: ['plats-du-jour'] },
    {
      nom: 'Quiche au thon et a la tomate',
      categories: ['snacking'],
      en_avant: true,
      fin: '2026-03-09 23:59'
    },
    {
      nom: 'Burger l\'Ambert + frites ou salade',
      categories: ['snacking'],
      en_avant: true,
      fin: '2026-03-09 23:59'
    },
    {
      nom: 'Wrap au poulet + frites/ou salade',
      categories: ['snacking'],
      en_avant: true,
      fin: '2026-03-09 23:59'
    },
    {
      nom: 'Sandwich Italien',
      categories: ['snacking'],
      en_avant: true,
      fin: '2026-03-09 23:59'
    },
    {
      nom: 'Quiche stalee',
      categories: ['snacking'],
      en_avant: true,
      fin: '2026-03-08 23:59'
    },
    { nom: 'Cookie chocolat noisettes', categories: ['desserts'] }
  ];

  const sections = extractMenuSections(catalog, categories, '2026-03-09');

  assert.deepEqual(sections.plats, [
    'Effiloche de porc sauce moutarde',
    'Quiche au thon et a la tomate'
  ]);
  assert.deepEqual(sections.desserts, ['Cookie chocolat noisettes']);
});

test('shouldPostMenu is false when there is no plat du jour', () => {
  const sections = {
    plats: [],
    desserts: ['Cookie chocolat']
  };

  assert.equal(shouldPostMenu(sections), false);
});

test('finalizeMenuSections adds fallback plat when menu detail has plat du jour filter', () => {
  const sections = {
    plats: [],
    desserts: ['Cookie chocolat']
  };

  const finalSections = finalizeMenuSections(
    sections,
    {
      nom: 'Menu plat du jour',
      slug: 'menu-plat-du-jour',
      filtre_categories: [
        { id: 2, nom: 'Plat du jour', position: 0 },
        { id: 21, nom: 'Dessert', position: 0 },
        { id: 1, nom: 'Boisson', position: 100 }
      ]
    },
    true
  );

  assert.deepEqual(finalSections.plats, ['Plat du jour (detail non expose par l API)']);
  assert.deepEqual(finalSections.desserts, ['Cookie chocolat']);
});

test('shouldPostMenu is false when target day is closed', () => {
  const sections = {
    plats: ['Plat du jour'],
    desserts: ['Cookie chocolat']
  };

  assert.equal(shouldPostMenu(sections, false), false);
});

test('buildSlackMessage formats only relevant sections', () => {
  const text = buildSlackMessage(new Date('2026-03-09T09:00:00Z'), {
    plats: ['Blanquette de veau'],
    desserts: ['Cookie chocolat', 'Part de flan']
  });

  assert.match(text, /Menu du jour GOOTU/i);
  assert.match(text, /Blanquette de veau/);
  assert.match(text, /Cookie chocolat/);
  assert.doesNotMatch(text, /boisson/i);
});
