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

  assert.deepEqual(sections.plats, [
    {
      nom: 'Blanquette de veau',
      hasGoatOrSheepCheese: false
    }
  ]);
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
    {
      nom: 'Effiloche de porc sauce moutarde',
      hasGoatOrSheepCheese: false
    },
    {
      nom: 'Quiche au thon et a la tomate',
      hasGoatOrSheepCheese: false
    }
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

  assert.deepEqual(finalSections.plats, [
    {
      nom: 'Plat du jour (detail non expose par l API)',
      hasGoatOrSheepCheese: false
    }
  ]);
  assert.deepEqual(finalSections.desserts, ['Cookie chocolat']);
});

test('shouldPostMenu is false when target day is closed', () => {
  const sections = {
    plats: [
      {
        nom: 'Plat du jour',
        hasGoatOrSheepCheese: false
      }
    ],
    desserts: ['Cookie chocolat']
  };

  assert.equal(shouldPostMenu(sections, false), false);
});

test('buildSlackMessage formats only relevant sections', () => {
  const text = buildSlackMessage(new Date('2026-03-09T09:00:00Z'), {
    plats: [
      {
        nom: 'Blanquette de veau',
        hasGoatOrSheepCheese: false
      }
    ],
    desserts: ['Cookie chocolat', 'Part de flan']
  });

  assert.match(text, /Menu du jour GOOTU/i);
  assert.match(text, /Blanquette de veau/);
  assert.match(text, /Cookie chocolat/);
  assert.doesNotMatch(text, /boisson/i);
});

test('buildSlackMessage switches header and plat line emoji for goat or sheep cheese', () => {
  const text = buildSlackMessage(new Date('2026-03-09T09:00:00Z'), {
    plats: [
      {
        nom: 'Gratin au chevre',
        hasGoatOrSheepCheese: true
      },
      {
        nom: 'Effiloche de porc sauce moutarde',
        hasGoatOrSheepCheese: false
      }
    ],
    desserts: []
  });

  assert.match(text, /^:goat_dead: Menu du jour GOOTU - /m);
  assert.match(text, /- :goat_dead: Gratin au chevre/);
  assert.match(text, /- Effiloche de porc sauce moutarde/);
});

test('extractMenuSections marks goat or sheep cheese plats with keyword matching', () => {
  const categories = [
    { nom: 'Plats du jour', slug: 'plats-du-jour' }
  ];

  const catalog = [
    { nom: 'Pates au Roquefort', categories: ['plats-du-jour'] },
    { nom: 'Tarte aux legumes', categories: ['plats-du-jour'] }
  ];

  const sections = extractMenuSections(catalog, categories, '2026-03-09');

  assert.deepEqual(sections.plats, [
    {
      nom: 'Pates au Roquefort',
      hasGoatOrSheepCheese: true
    },
    {
      nom: 'Tarte aux legumes',
      hasGoatOrSheepCheese: false
    }
  ]);
});

test('extractMenuSections detects goat or sheep specialties with case and accent variations', () => {
  const categories = [
    { nom: 'Plats du jour', slug: 'plats-du-jour' }
  ];

  const catalog = [
    { nom: 'Salade FETA tomates', categories: ['plats-du-jour'] },
    { nom: 'Tarte au CHÈVRE et miel', categories: ['plats-du-jour'] },
    { nom: 'Pates au PECORINO romano', categories: ['plats-du-jour'] },
    { nom: 'Assiette Ossau-Iraty', categories: ['plats-du-jour'] },
    { nom: 'Poulet basquaise', categories: ['plats-du-jour'] }
  ];

  const sections = extractMenuSections(catalog, categories, '2026-03-09');

  assert.deepEqual(sections.plats, [
    {
      nom: 'Salade FETA tomates',
      hasGoatOrSheepCheese: true
    },
    {
      nom: 'Tarte au CHÈVRE et miel',
      hasGoatOrSheepCheese: true
    },
    {
      nom: 'Pates au PECORINO romano',
      hasGoatOrSheepCheese: true
    },
    {
      nom: 'Assiette Ossau-Iraty',
      hasGoatOrSheepCheese: true
    },
    {
      nom: 'Poulet basquaise',
      hasGoatOrSheepCheese: false
    }
  ]);
});
