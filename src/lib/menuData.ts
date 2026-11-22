/**
 * Menu seed data for Lipi Snacks restaurant.
 *
 * Each item has:
 *   - slug        : used as the local image filename (e.g. `samosa.png`)
 *                   and as the Cloudinary public_id (e.g. `restaurant/menu/samosa`)
 *   - name        : dish name shown to customers
 *   - description : short blurb shown under the name
 *   - category    : Starters / Main / Rice / Breads / South Indian / Combos /
 *                   Beverages / Desserts
 *   - price       : Indian Rupees (integer, no decimals for cleanliness)
 *   - veg         : true = vegetarian
 *   - prepTime    : minutes
 *
 * Prices are realistic mid-tier Indian café rates (Nov 2026).
 */
export interface SeedMenuItem {
  slug: string;
  name: string;
  description: string;
  category: string;
  price: number;
  veg: boolean;
  prepTime: number;
}

export const SEED_MENU: SeedMenuItem[] = [
  // ---------- Starters ----------
  {
    slug: 'samosa',
    name: 'Punjabi Samosa (2 pc)',
    description: 'Crispy golden pastry stuffed with spiced potato & peas, served with tamarind and mint chutney.',
    category: 'Starters',
    price: 60,
    veg: true,
    prepTime: 10,
  },
  {
    slug: 'paneer_tikka',
    name: 'Paneer Tikka',
    description: 'Char-grilled cottage cheese cubes marinated in yogurt, ginger-garlic and Kashmiri spices. 6 pieces.',
    category: 'Starters',
    price: 220,
    veg: true,
    prepTime: 15,
  },
  {
    slug: 'chicken_tikka',
    name: 'Chicken Tikka',
    description: 'Tandoor-roasted chicken pieces in a spiced yogurt marinade with bell peppers and onion. 8 pieces.',
    category: 'Starters',
    price: 280,
    veg: false,
    prepTime: 18,
  },
  {
    slug: 'veg_pakora',
    name: 'Veg Pakora',
    description: 'Mixed onion and spinach fritters in chickpea-flour batter with green chilli. Crispy and hot.',
    category: 'Starters',
    price: 90,
    veg: true,
    prepTime: 8,
  },
  {
    slug: 'hara_bhara_kebab',
    name: 'Hara Bhara Kebab (4 pc)',
    description: 'Spinach, green pea and potato patties with cashew crunch, lightly pan-seared. Served with mint chutney.',
    category: 'Starters',
    price: 180,
    veg: true,
    prepTime: 12,
  },
  {
    slug: 'chilli_paneer',
    name: 'Chilli Paneer (Semi-Gravy)',
    description: 'Indo-Chinese style paneer tossed with bell peppers, garlic and soy in a sticky-sweet sauce.',
    category: 'Starters',
    price: 240,
    veg: true,
    prepTime: 14,
  },

  // ---------- Main Course ----------
  {
    slug: 'butter_chicken',
    name: 'Butter Chicken',
    description: 'Tandoori chicken simmered in a creamy tomato gravy with butter, cream and aromatic spices.',
    category: 'Main',
    price: 320,
    veg: false,
    prepTime: 22,
  },
  {
    slug: 'paneer_butter_masala',
    name: 'Paneer Butter Masala',
    description: 'Soft paneer cubes in a rich, mildly sweet tomato-cashew gravy with cream and butter.',
    category: 'Main',
    price: 260,
    veg: true,
    prepTime: 18,
  },
  {
    slug: 'dal_makhani',
    name: 'Dal Makhani',
    description: 'Slow-cooked black lentils and kidney beans in a creamy tomato-butter gravy. A North-Indian classic.',
    category: 'Main',
    price: 220,
    veg: true,
    prepTime: 20,
  },
  {
    slug: 'rogan_josh',
    name: 'Mutton Rogan Josh',
    description: 'Tender lamb slow-cooked in Kashmiri spices and yogurt, finished with a layer of ghee.',
    category: 'Main',
    price: 380,
    veg: false,
    prepTime: 28,
  },
  {
    slug: 'kadai_paneer',
    name: 'Kadai Paneer',
    description: 'Paneer and crunchy bell peppers in a spicy tomato gravy tempered with freshly roasted kadai masala.',
    category: 'Main',
    price: 270,
    veg: true,
    prepTime: 16,
  },
  {
    slug: 'chole',
    name: 'Chole Masala',
    description: 'Punjabi-style chickpeas simmered in onion-tomato gravy with ginger, anardana and whole spices.',
    category: 'Main',
    price: 200,
    veg: true,
    prepTime: 15,
  },

  // ---------- Rice ----------
  {
    slug: 'veg_biriyani',
    name: 'Veg Dum Biriyani',
    description: 'Long-grain basmati layered with spiced vegetables and saffron, dum-cooked. Served with raita and salan.',
    category: 'Rice',
    price: 240,
    veg: true,
    prepTime: 25,
  },
  {
    slug: 'chicken_biriyani',
    name: 'Hyderabadi Chicken Biriyani',
    description: 'Marinated chicken layered with basmati, fried onions and saffron, sealed and dum-cooked.',
    category: 'Rice',
    price: 320,
    veg: false,
    prepTime: 28,
  },
  {
    slug: 'egg_biriyani',
    name: 'Egg Biriyani',
    description: 'Spiced basmati rice with boiled eggs, fried onions and aromatic biriyani masala.',
    category: 'Rice',
    price: 220,
    veg: false,
    prepTime: 22,
  },
  {
    slug: 'jeera_rice',
    name: 'Jeera Rice',
    description: 'Fluffy basmati rice tempered with cumin seeds and ghee. Pairs perfectly with any curry.',
    category: 'Rice',
    price: 110,
    veg: true,
    prepTime: 12,
  },
  {
    slug: 'veg_fried_rice',
    name: 'Veg Fried Rice',
    description: 'Indo-Chinese style wok-tossed rice with crunchy vegetables, soy and a hint of vinegar.',
    category: 'Rice',
    price: 160,
    veg: true,
    prepTime: 12,
  },

  // ---------- Breads ----------
  {
    slug: 'butter_naan',
    name: 'Butter Naan',
    description: 'Soft tandoor-baked leavened bread brushed generously with melted butter.',
    category: 'Breads',
    price: 50,
    veg: true,
    prepTime: 6,
  },
  {
    slug: 'garlic_naan',
    name: 'Garlic Naan',
    description: 'Naan topped with chopped garlic and coriander, baked in the tandoor and buttered.',
    category: 'Breads',
    price: 60,
    veg: true,
    prepTime: 6,
  },
  {
    slug: 'tandoori_roti',
    name: 'Tandoori Roti',
    description: 'Whole wheat flatbread baked in the tandoor. Light and wholesome.',
    category: 'Breads',
    price: 30,
    veg: true,
    prepTime: 5,
  },

  // ---------- South Indian ----------
  {
    slug: 'masala_dosa',
    name: 'Masala Dosa',
    description: 'Crispy golden rice-lentil crepe stuffed with spiced potato masala. Served with sambar and 3 chutneys.',
    category: 'South Indian',
    price: 140,
    veg: true,
    prepTime: 14,
  },
  {
    slug: 'idli_sambar',
    name: 'Idli Sambar (3 pc)',
    description: 'Steamed rice and lentil cakes served with hot sambar and coconut-chutney. Light and healthy.',
    category: 'South Indian',
    price: 100,
    veg: true,
    prepTime: 10,
  },
  {
    slug: 'medu_vada',
    name: 'Medu Vada (2 pc)',
    description: 'Crispy lentil donuts with a soft centre, served with sambar and chutney.',
    category: 'South Indian',
    price: 90,
    veg: true,
    prepTime: 10,
  },

  // ---------- Combos ----------
  {
    slug: 'veg_thali',
    name: 'Veg Thali (Mini Feast)',
    description: 'A complete meal: dal, paneer sabzi, mixed veg, raita, rice, 2 roti, papad, pickle & a sweet.',
    category: 'Combos',
    price: 280,
    veg: true,
    prepTime: 20,
  },

  // ---------- Beverages ----------
  {
    slug: 'masala_chai',
    name: 'Masala Chai',
    description: 'Hot milk tea brewed with ginger, cardamom and a secret mix of spices. Served in a kulhad.',
    category: 'Beverages',
    price: 40,
    veg: true,
    prepTime: 6,
  },
  {
    slug: 'sweet_lassi',
    name: 'Sweet Lassi',
    description: 'Churned yogurt drink sweetened with sugar, topped with a spoon of malai and pistachio.',
    category: 'Beverages',
    price: 80,
    veg: true,
    prepTime: 5,
  },
  {
    slug: 'mango_lassi',
    name: 'Mango Lassi',
    description: 'Thick yogurt blended with sweet alphonso mango pulp, topped with pistachio slivers.',
    category: 'Beverages',
    price: 110,
    veg: true,
    prepTime: 5,
  },
  {
    slug: 'freshlime',
    name: 'Fresh Lime Soda',
    description: 'Sparkling soda with fresh lime juice, choice of sweet, salted or mixed. Served chilled.',
    category: 'Beverages',
    price: 70,
    veg: true,
    prepTime: 4,
  },
  {
    slug: 'filter_coffee',
    name: 'South Indian Filter Coffee',
    description: 'Strong decoction frothed with hot milk and sugar. Served in a steel tumbler and dabarah.',
    category: 'Beverages',
    price: 50,
    veg: true,
    prepTime: 6,
  },

  // ---------- Desserts ----------
  {
    slug: 'gulab_jamun',
    name: 'Gulab Jamun (2 pc)',
    description: 'Warm milk-solid dumplings soaked in cardamom-rose sugar syrup. Served with chopped pistachio.',
    category: 'Desserts',
    price: 90,
    veg: true,
    prepTime: 5,
  },
  {
    slug: 'rasmalai',
    name: 'Rasmalai (3 pc)',
    description: 'Soft cottage-cheese discs in saffron-cardamom milk, garnished with pistachio and rose petals.',
    category: 'Desserts',
    price: 130,
    veg: true,
    prepTime: 5,
  },
  {
    slug: 'gajar_halwa',
    name: 'Gajar Ka Halwa',
    description: 'Slow-cooked grated carrot pudding with milk, ghee, cashews and raisins. Served warm.',
    category: 'Desserts',
    price: 120,
    veg: true,
    prepTime: 6,
  },
  {
    slug: 'kulfi',
    name: 'Kulfi Falooda',
    description: 'Indian-style dense ice cream on a stick with rose syrup, vermicelli and basil seeds.',
    category: 'Desserts',
    price: 100,
    veg: true,
    prepTime: 4,
  },
];
