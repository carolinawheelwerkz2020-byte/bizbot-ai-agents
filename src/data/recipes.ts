export interface Ingredient {
  item: string;
  amount: string;
  unit: string;
}

export interface Recipe {
  id: string;
  title: string;
  description: string;
  image: string;
  time: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  calories: number;
  tags: string[];
  ingredients: Ingredient[];
  instructions: string[];
}

export const DISCOVERY_RECIPES: Recipe[] = [
  {
    id: '1',
    title: 'Beef Wellington',
    description: 'A luxurious classic featuring tender beef fillet wrapped in flaky puff pastry with mushroom duxelles.',
    image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&q=80&w=800',
    time: '2h 30m',
    difficulty: 'Hard',
    calories: 850,
    tags: ['Classic', 'Luxury', 'Beef'],
    ingredients: [
      { item: 'Beef Fillet', amount: '1', unit: 'kg' },
      { item: 'Puff Pastry', amount: '500', unit: 'g' },
      { item: 'Mushrooms', amount: '500', unit: 'g' },
      { item: 'Prosciutto', amount: '12', unit: 'slices' },
      { item: 'English Mustard', amount: '2', unit: 'tbsp' }
    ],
    instructions: [
      'Sear the beef on all sides until browned.',
      'Finely chop and sauté mushrooms to create a duxelles.',
      'Wrap the beef in prosciutto and duxelles, then roll in puff pastry.',
      'Chill for 30 minutes, then bake at 200°C until golden.'
    ]
  },
  {
    id: '2',
    title: 'Miso Glazed Black Cod',
    description: 'Silky, buttery black cod marinated in a sweet and savory miso glaze, popularized by Nobu.',
    image: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&q=80&w=800',
    time: '45m',
    difficulty: 'Medium',
    calories: 420,
    tags: ['Seafood', 'Japanese', 'Fusion'],
    ingredients: [
      { item: 'Black Cod Fillets', amount: '4', unit: 'pcs' },
      { item: 'White Miso Paste', amount: '3', unit: 'tbsp' },
      { item: 'Sake', amount: '2', unit: 'tbsp' },
      { item: 'Mirin', amount: '2', unit: 'tbsp' },
      { item: 'Sugar', amount: '2', unit: 'tbsp' }
    ],
    instructions: [
      'Mix miso, sake, mirin, and sugar to create the marinade.',
      'Marinate cod for at least 24 hours (or 30 mins if rushing).',
      'Sear the fish in a hot pan, then finish under the broiler for 2-3 minutes.'
    ]
  },
  {
    id: '3',
    title: 'Truffle Mushroom Risotto',
    description: 'Creamy Arborio rice slow-cooked with earthy wild mushrooms and finished with decadent truffle oil.',
    image: 'https://images.unsplash.com/photo-1476124369491-e7addf5db371?auto=format&fit=crop&q=80&w=800',
    time: '40m',
    difficulty: 'Medium',
    calories: 550,
    tags: ['Vegetarian', 'Italian', 'Truffle'],
    ingredients: [
      { item: 'Arborio Rice', amount: '300', unit: 'g' },
      { item: 'Wild Mushrooms', amount: '400', unit: 'g' },
      { item: 'Vegetable Stock', amount: '1.2', unit: 'L' },
      { item: 'Parmesan', amount: '50', unit: 'g' },
      { item: 'Truffle Oil', amount: '1', unit: 'tsp' }
    ],
    instructions: [
      'Sauté mushrooms until golden, set aside.',
      'Toast rice in butter, then add stock one ladle at a time, stirring constantly.',
      'Fold in mushrooms and parmesan once rice is al dente.',
      'Drizzle with truffle oil before serving.'
    ]
  },
  {
    id: '4',
    title: 'Pan-Seared Scallops',
    description: 'Perfectly caramelized sea scallops served over a silky cauliflower purée with lemon-herb butter.',
    image: 'https://images.unsplash.com/photo-1599458252573-56ae36120de1?auto=format&fit=crop&q=80&w=800',
    time: '30m',
    difficulty: 'Easy',
    calories: 320,
    tags: ['Seafood', 'Appetizer', 'Gourmet'],
    ingredients: [
      { item: 'Sea Scallops', amount: '12', unit: 'large' },
      { item: 'Cauliflower', amount: '1', unit: 'head' },
      { item: 'Butter', amount: '50', unit: 'g' },
      { item: 'Heavy Cream', amount: '50', unit: 'ml' },
      { item: 'Lemon', amount: '1', unit: 'pc' }
    ],
    instructions: [
      'Steam cauliflower and blend with cream and butter until smooth.',
      'Pat scallops dry and sear in a smoking hot pan for 90 seconds per side.',
      'Deglaze pan with lemon juice and butter to create a sauce.'
    ]
  },
  {
    id: '5',
    title: 'Duck à l\'Orange',
    description: 'Crispy-skinned duck breast served with a classic French bitter orange sauce.',
    image: 'https://images.unsplash.com/photo-1514516317522-f9420556209b?auto=format&fit=crop&q=80&w=800',
    time: '50m',
    difficulty: 'Medium',
    calories: 680,
    tags: ['French', 'Duck', 'Classic'],
    ingredients: [
      { item: 'Duck Breast', amount: '2', unit: 'pcs' },
      { item: 'Oranges', amount: '3', unit: 'pcs' },
      { item: 'Chicken Stock', amount: '200', unit: 'ml' },
      { item: 'Grand Marnier', amount: '2', unit: 'tbsp' },
      { item: 'Sugar', amount: '1', unit: 'tbsp' }
    ],
    instructions: [
      'Score duck skin and sear fat-side down until crispy.',
      'Reduce orange juice, stock, and liqueur until syrupy.',
      'Finish duck in the oven until medium-rare.',
      'Serve sliced with the orange reduction.'
    ]
  },
  {
    id: '6',
    title: 'Lobster Thermidor',
    description: 'A rich mixture of cooked lobster meat, egg yolks, and brandy, stuffed into a lobster shell.',
    image: 'https://images.unsplash.com/photo-1553163147-622ab57ad1ad?auto=format&fit=crop&q=80&w=800',
    time: '1h 10m',
    difficulty: 'Hard',
    calories: 920,
    tags: ['Seafood', 'French', 'Luxury'],
    ingredients: [
      { item: 'Lobster', amount: '2', unit: 'large' },
      { item: 'Mustard', amount: '1', unit: 'tsp' },
      { item: 'Cognac', amount: '50', unit: 'ml' },
      { item: 'Gruyère Cheese', amount: '100', unit: 'g' },
      { item: 'Heavy Cream', amount: '150', unit: 'ml' }
    ],
    instructions: [
      'Boil and split lobsters, removing meat.',
      'Make a sauce with cream, cognac, and mustard.',
      'Mix lobster meat with sauce and stuff back into shells.',
      'Top with Gruyère and grill until bubbling.'
    ]
  },
  {
    id: '7',
    title: 'Ratatouille (Confit Byaldi)',
    description: 'The elegant, layered version of the classic Provençal vegetable stew.',
    image: 'https://images.unsplash.com/photo-1572453800999-e8d2d1589b7c?auto=format&fit=crop&q=80&w=800',
    time: '1h 45m',
    difficulty: 'Medium',
    calories: 280,
    tags: ['Vegetarian', 'French', 'Healthy'],
    ingredients: [
      { item: 'Eggplant', amount: '2', unit: 'pcs' },
      { item: 'Zucchini', amount: '2', unit: 'pcs' },
      { item: 'Yellow Squash', amount: '2', unit: 'pcs' },
      { item: 'Tomatoes', amount: '4', unit: 'pcs' },
      { item: 'Bell Pepper Sauce', amount: '1', unit: 'cup' }
    ],
    instructions: [
      'Thinly slice all vegetables into uniform rounds.',
      'Spread pepper sauce in a baking dish.',
      'Arrange vegetables in a spiraling pattern over the sauce.',
      'Cover and bake slowly at 150°C for 90 minutes.'
    ]
  },
  {
    id: '8',
    title: 'Saffron Bouillabaisse',
    description: 'A traditional Provençal fish stew with saffron, fennel, and assorted seafood.',
    image: 'https://images.unsplash.com/photo-1534766555764-ce878a5e3a2b?auto=format&fit=crop&q=80&w=800',
    time: '1h 20m',
    difficulty: 'Medium',
    calories: 450,
    tags: ['Seafood', 'French', 'Saffron'],
    ingredients: [
      { item: 'Mixed White Fish', amount: '600', unit: 'g' },
      { item: 'Mussels', amount: '200', unit: 'g' },
      { item: 'Shrimp', amount: '8', unit: 'pcs' },
      { item: 'Saffron Threads', amount: '1', unit: 'pinch' },
      { item: 'Fennel', amount: '1', unit: 'bulb' }
    ],
    instructions: [
      'Sauté fennel and onions, then add stock and saffron.',
      'Simmer fish and seafood in the broth until just cooked.',
      'Serve with crusty bread and rouille sauce.'
    ]
  },
  {
    id: '9',
    title: 'Rack of Lamb with Herb Crust',
    description: 'Tender rack of lamb coated in a vibrant crust of parsley, mint, and toasted breadcrumbs.',
    image: 'https://images.unsplash.com/photo-1603048297172-c92544798d5a?auto=format&fit=crop&q=80&w=800',
    time: '45m',
    difficulty: 'Medium',
    calories: 720,
    tags: ['Meat', 'Herbaceous', 'Gourmet'],
    ingredients: [
      { item: 'Rack of Lamb', amount: '1', unit: 'pc' },
      { item: 'Breadcrumbs', amount: '50', unit: 'g' },
      { item: 'Parsley & Mint', amount: '1', unit: 'bunch' },
      { item: 'Dijon Mustard', amount: '2', unit: 'tbsp' },
      { item: 'Garlic', amount: '2', unit: 'cloves' }
    ],
    instructions: [
      'Sear the lamb rack then coat with mustard.',
      'Press the herb and breadcrumb mixture onto the lamb.',
      'Roast at 200°C for 20-25 minutes for medium-rare.'
    ]
  },
  {
    id: '10',
    title: 'Wild Mushroom Velouté',
    description: 'A silky-smooth, deep earthy soup made from mixed forest mushrooms and heavy cream.',
    image: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&q=80&w=800',
    time: '35m',
    difficulty: 'Easy',
    calories: 310,
    tags: ['Soup', 'Vegetarian', 'Earthy'],
    ingredients: [
      { item: 'Porcini & Cremini', amount: '500', unit: 'g' },
      { item: 'Shallots', amount: '2', unit: 'pcs' },
      { item: 'Chicken Stock', amount: '1', unit: 'L' },
      { item: 'Heavy Cream', amount: '100', unit: 'ml' },
      { item: 'Thyme', amount: '2', unit: 'sprigs' }
    ],
    instructions: [
      'Sauté shallots and mushrooms with thyme.',
      'Add stock and simmer for 20 minutes.',
      'Blend until perfectly smooth and stir in cream.'
    ]
  },
  {
    id: '11',
    title: 'Tuna Tartare with Avocado',
    description: 'Fresh sushi-grade tuna cubes tossed in soy-sesame dressing, layered with creamy avocado.',
    image: 'https://images.unsplash.com/photo-1534604973900-c41ab4c5d4b0?auto=format&fit=crop&q=80&w=800',
    time: '20m',
    difficulty: 'Easy',
    calories: 240,
    tags: ['Raw', 'Seafood', 'Light'],
    ingredients: [
      { item: 'Ahi Tuna', amount: '300', unit: 'g' },
      { item: 'Avocado', amount: '1', unit: 'pc' },
      { item: 'Soy Sauce', amount: '2', unit: 'tbsp' },
      { item: 'Sesame Oil', amount: '1', unit: 'tsp' },
      { item: 'Lime', amount: '1', unit: 'pc' }
    ],
    instructions: [
      'Dice tuna into small cubes and chill.',
      'Mash avocado with lime juice and salt.',
      'Toss tuna with soy and sesame oil.',
      'Mold avocado into a ring and top with tuna.'
    ]
  },
  {
    id: '12',
    title: 'Coq au Vin',
    description: 'Classic French chicken braised with red wine, lardons, mushrooms, and pearl onions.',
    image: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&q=80&w=800',
    time: '2h',
    difficulty: 'Medium',
    calories: 780,
    tags: ['French', 'Chicken', 'Comfort'],
    ingredients: [
      { item: 'Whole Chicken', amount: '1.5', unit: 'kg' },
      { item: 'Red Wine (Pinot Noir)', amount: '750', unit: 'ml' },
      { item: 'Bacon Lardons', amount: '150', unit: 'g' },
      { item: 'Pearl Onions', amount: '12', unit: 'pcs' },
      { item: 'Mushrooms', amount: '250', unit: 'g' }
    ],
    instructions: [
      'Brown chicken and bacon in a heavy pot.',
      'Add wine, stock, and herbs; braise for 90 minutes.',
      'Sauté mushrooms and onions separately and add at the end.'
    ]
  },
  {
    id: '13',
    title: 'Chateaubriand',
    description: 'The center cut of the beef tenderloin, served with a classic Béarnaise sauce.',
    image: 'https://images.unsplash.com/photo-1600891964599-f61ba0e24092?auto=format&fit=crop&q=80&w=800',
    time: '55m',
    difficulty: 'Hard',
    calories: 940,
    tags: ['Steak', 'Luxury', 'Beef'],
    ingredients: [
      { item: 'Beef Center Cut', amount: '600', unit: 'g' },
      { item: 'Egg Yolks', amount: '3', unit: 'pcs' },
      { item: 'Clarified Butter', amount: '200', unit: 'g' },
      { item: 'Tarragon', amount: '2', unit: 'tbsp' },
      { item: 'Shallots', amount: '1', unit: 'pc' }
    ],
    instructions: [
      'Roast the beef until desired doneness (medium-rare is best).',
      'Whisk yolks and butter over a double boiler for the sauce.',
      'Fold in chopped tarragon and shallot reduction.'
    ]
  },
  {
    id: '14',
    title: 'Elevated Lobster Roll',
    description: 'Chilled Maine lobster meat tossed in light tarragon mayo on a toasted brioche bun.',
    image: 'https://images.unsplash.com/photo-1599458300439-05c0838382c6?auto=format&fit=crop&q=80&w=800',
    time: '30m',
    difficulty: 'Easy',
    calories: 580,
    tags: ['Seafood', 'Classic', 'Casual'],
    ingredients: [
      { item: 'Lobster Meat', amount: '400', unit: 'g' },
      { item: 'Brioche Buns', amount: '4', unit: 'pcs' },
      { item: 'Mayonnaise', amount: '3', unit: 'tbsp' },
      { item: 'Fresh Tarragon', amount: '1', unit: 'tbsp' },
      { item: 'Celery', amount: '1', unit: 'stalk' }
    ],
    instructions: [
      'Mix lobster with mayo, tarragon, and finely diced celery.',
      'Split and butter the buns, then toast until golden.',
      'Stuff with lobster and serve with a lemon wedge.'
    ]
  },
  {
    id: '15',
    title: 'Squid Ink Pasta with Chorizo',
    description: 'Dramatic black pasta tossed with spicy chorizo, garlic, and cherry tomatoes.',
    image: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&q=80&w=800',
    time: '25m',
    difficulty: 'Easy',
    calories: 520,
    tags: ['Pasta', 'Spicy', 'Seafood'],
    ingredients: [
      { item: 'Squid Ink Pasta', amount: '400', unit: 'g' },
      { item: 'Chorizo', amount: '150', unit: 'g' },
      { item: 'Cherry Tomatoes', amount: '200', unit: 'g' },
      { item: 'Garlic', amount: '3', unit: 'cloves' },
      { item: 'Parsley', amount: '1', unit: 'handful' }
    ],
    instructions: [
      'Cook pasta until al dente.',
      'Fry chorizo until oils are released, then add garlic and tomatoes.',
      'Toss pasta in the pan with a splash of pasta water.'
    ]
  },
  {
    id: '16',
    title: 'Red Wine Braised Short Ribs',
    description: 'Fall-off-the-bone tender ribs slow-cooked in a deep, rich red wine reduction.',
    image: 'https://images.unsplash.com/photo-1544124499-58912cbddaad?auto=format&fit=crop&q=80&w=800',
    time: '3h 30m',
    difficulty: 'Medium',
    calories: 890,
    tags: ['Beef', 'Slow Cooked', 'Rich'],
    ingredients: [
      { item: 'Beef Short Ribs', amount: '1.2', unit: 'kg' },
      { item: 'Cabernet Sauvignon', amount: '500', unit: 'ml' },
      { item: 'Beef Stock', amount: '500', unit: 'ml' },
      { item: 'Carrots & Celery', amount: '2', unit: 'each' },
      { item: 'Tomato Paste', amount: '2', unit: 'tbsp' }
    ],
    instructions: [
      'Sear ribs until dark brown.',
      'Sauté vegetables and tomato paste, then deglaze with wine.',
      'Cover with stock and braise at 150°C for 3 hours.'
    ]
  },
  {
    id: '17',
    title: 'Roasted Beet & Goat Cheese',
    description: 'Sweet roasted beets with tangy goat cheese, candied walnuts, and balsamic glaze.',
    image: 'https://images.unsplash.com/photo-1546793665-c74683c3f43d?auto=format&fit=crop&q=80&w=800',
    time: '1h',
    difficulty: 'Easy',
    calories: 340,
    tags: ['Salad', 'Vegetarian', 'Beets'],
    ingredients: [
      { item: 'Beets', amount: '3', unit: 'large' },
      { item: 'Goat Cheese', amount: '100', unit: 'g' },
      { item: 'Walnuts', amount: '50', unit: 'g' },
      { item: 'Arugula', amount: '100', unit: 'g' },
      { item: 'Balsamic Glaze', amount: '2', unit: 'tbsp' }
    ],
    instructions: [
      'Roast beets in foil until tender, then peel and slice.',
      'Toast walnuts with a little honey.',
      'Assemble on a bed of arugula and crumble cheese over top.'
    ]
  },
  {
    id: '18',
    title: 'Thai Green Curry Prawns',
    description: 'Fragrant and spicy curry with coconut milk, lemongrass, and fresh prawns.',
    image: 'https://images.unsplash.com/photo-1455619452474-d2be8b1e70cd?auto=format&fit=crop&q=80&w=800',
    time: '35m',
    difficulty: 'Medium',
    calories: 410,
    tags: ['Thai', 'Spicy', 'Seafood'],
    ingredients: [
      { item: 'Prawns', amount: '12', unit: 'large' },
      { item: 'Green Curry Paste', amount: '2', unit: 'tbsp' },
      { item: 'Coconut Milk', amount: '400', unit: 'ml' },
      { item: 'Bamboo Shoots', amount: '100', unit: 'g' },
      { item: 'Basil', amount: '1', unit: 'handful' }
    ],
    instructions: [
      'Fry curry paste in a little coconut cream until fragrant.',
      'Add rest of milk and simmer with vegetables.',
      'Poach prawns in the sauce for 3 minutes and add basil.'
    ]
  },
  {
    id: '19',
    title: 'Moroccan Lamb Tagine',
    description: 'A sweet and savory stew with tender lamb, apricots, and warm spices.',
    image: 'https://images.unsplash.com/photo-1541529086526-db283c563270?auto=format&fit=crop&q=80&w=800',
    time: '2h',
    difficulty: 'Medium',
    calories: 740,
    tags: ['Moroccan', 'Lamb', 'Spiced'],
    ingredients: [
      { item: 'Lamb Shoulder', amount: '800', unit: 'g' },
      { item: 'Dried Apricots', amount: '100', unit: 'g' },
      { item: 'Chickpeas', amount: '400', unit: 'g' },
      { item: 'Cumin & Cinnamon', amount: '1', unit: 'tsp each' },
      { item: 'Couscous', amount: '200', unit: 'g' }
    ],
    instructions: [
      'Brown lamb and spices in a tagine or heavy pot.',
      'Add stock, apricots, and chickpeas; simmer for 90 minutes.',
      'Serve over fluffy couscous.'
    ]
  },
  {
    id: '20',
    title: 'Lemon Meringue Tart',
    description: 'Zesty lemon curd in a buttery shortcrust pastry, topped with toasted Swiss meringue.',
    image: 'https://images.unsplash.com/photo-1519915028121-7d3463d20b13?auto=format&fit=crop&q=80&w=800',
    time: '1h 30m',
    difficulty: 'Hard',
    calories: 480,
    tags: ['Dessert', 'Citrus', 'Baking'],
    ingredients: [
      { item: 'Shortcrust Pastry', amount: '1', unit: 'pc' },
      { item: 'Lemons', amount: '4', unit: 'pcs' },
      { item: 'Sugar', amount: '200', unit: 'g' },
      { item: 'Egg Whites', amount: '3', unit: 'pcs' },
      { item: 'Cornstarch', amount: '2', unit: 'tbsp' }
    ],
    instructions: [
      'Blind bake the pastry case until golden.',
      'Cook lemon juice, zest, sugar, and starch until thick.',
      'Whisk egg whites with sugar over heat to make meringue.',
      'Pipe onto lemon base and torch until browned.'
    ]
  }
];
