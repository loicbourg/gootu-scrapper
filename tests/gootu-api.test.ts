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

test('extractMenuSections separates active snacking from plats du jour', () => {
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
    }
  ]);

  assert.deepEqual(sections.snacking, [
    {
      nom: 'Quiche au thon et a la tomate',
      hasGoatOrSheepCheese: false
    }
  ]);

  assert.deepEqual(sections.suggestions, []);
  assert.deepEqual(sections.desserts, ['Cookie chocolat noisettes']);
});

test('shouldPostMenu is false when there is no plat du jour', () => {
  const sections = {
    plats: [],
    desserts: ['Cookie chocolat']
  };

  assert.equal(shouldPostMenu(sections), false);
});

test('shouldPostMenu is false when only fallback plat is present', () => {
  const sections = {
    plats: [
      {
        nom: 'Plat du jour (detail non expose par l API)',
        hasGoatOrSheepCheese: false,
        isFallback: true
      }
    ],
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
      hasGoatOrSheepCheese: false,
      isFallback: true
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

test('extractMenuSections splits into snacking, plats du jour and suggestions', () => {
  const categories = [
    { nom: 'Plats du jour', slug: 'plats-du-jour' },
    { nom: 'Snacking', slug: 'snacking' }
  ];

  const catalog = [
    {
      nom: 'Hot-dog Américain',
      categories: ['snacking'],
      tarif_ttc1: 8.5,
      en_avant: true,
      fin: '2026-03-09 23:59'
    },
    { nom: 'Emince de poulet au gingembre', categories: ['plats-du-jour'], tarif_ttc1: 10 },
    { nom: 'Blanquette de veau', categories: ['plats-du-jour'], tarif_ttc1: 13.5 },
    {
      nom: 'Pates sauce saumon et fruits de mer',
      categories: ['plats-du-jour'],
      tarif_ttc1: 8.5,
      en_avant: false,
      fin: '2026-03-09 23:59'
    }
  ];

  const sections = extractMenuSections(catalog, categories, '2026-03-09');

  assert.deepEqual(sections.snacking, [
    {
      nom: 'Hot-dog Américain',
      hasGoatOrSheepCheese: false
    }
  ]);

  assert.deepEqual(sections.plats, [
    {
      nom: 'Emince de poulet au gingembre',
      hasGoatOrSheepCheese: false
    },
    {
      nom: 'Pates sauce saumon et fruits de mer',
      hasGoatOrSheepCheese: false
    }
  ]);

  assert.deepEqual(sections.suggestions, [
    {
      nom: 'Blanquette de veau',
      hasGoatOrSheepCheese: false
    }
  ]);
});

test('extractMenuSections classifies same-price plats above 13 euros as suggestions', () => {
  const categories = [
    { nom: 'Plats du jour', slug: 'plats-du-jour' }
  ];

  const catalog = [
    { nom: 'Plat A', categories: ['plats-du-jour'], tarif_ttc1: 13.5 },
    { nom: 'Plat B', categories: ['plats-du-jour'], tarif_ttc1: 13.5 }
  ];

  const sections = extractMenuSections(catalog, categories, '2026-03-09');

  assert.deepEqual(sections.snacking, []);
  assert.deepEqual(sections.plats, []);
  assert.deepEqual(sections.suggestions, [
    {
      nom: 'Plat A',
      hasGoatOrSheepCheese: false
    },
    {
      nom: 'Plat B',
      hasGoatOrSheepCheese: false
    }
  ]);
});

test('buildSlackMessage renders snacking and suggestions in dedicated sections', () => {
  const text = buildSlackMessage(new Date('2026-03-09T09:00:00Z'), {
    snacking: [
      {
        nom: 'Hot-dog Américain',
        hasGoatOrSheepCheese: false
      }
    ],
    plats: [
      {
        nom: 'Plat du jour classique',
        hasGoatOrSheepCheese: false
      }
    ],
    suggestions: [
      {
        nom: 'Suggestion du chef',
        hasGoatOrSheepCheese: false
      }
    ],
    desserts: ['Cookie chocolat']
  });

  assert.match(text, /Snacking:/);
  assert.match(text, /- Hot-dog Américain/);
  assert.match(text, /Plats du jour:/);
  assert.match(text, /- Plat du jour classique/);
  assert.match(text, /Suggestions:/);
  assert.match(text, /- Suggestion du chef/);
});
