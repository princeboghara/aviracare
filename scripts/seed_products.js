const db = require('../db');

const products = [
    {
        name: "Sea Buckthorn Juice (500 ml)",
        amount: 1299,
        pv: 300,
        image_url: "/images/logo.jpg",
        info: "Sea Buckthorn Juice is a rich natural source of Vitamin C, Omega 3, 6, 7, 9, and vital antioxidants. It promotes immune resistance, cellular rejuvenation, and comprehensive vitality.\n\nIngredients: Vitamin A, C, D3, E, B-Complex, Zinc, Magnesium, Mangosteen, Berries, and 20+ Vital Nutrients.",
        benefits: "• Helps maintain strong immunity and elevated energy levels.\n• Excellent natural tonic for skin radiance, cardiovascular support, and digestive health.\n• Powerful cellular antioxidant protection.",
        how_to_use: "Mix 15-30 ml juice in a glass of water and consume 1-2 times daily before meals."
    },
    {
        name: "Faminor Juice (500 ml)",
        amount: 1299,
        pv: 300,
        image_url: "/images/logo.jpg",
        info: "Faminor Juice is an Ayurvedic health tonic specially formulated for women's holistic wellness, hormonal balance, and daily energy restoration.\n\nIngredients: Ashoka, Shatavari, Lodhra, Aloe Vera, Giloy, Amla, and Natural Botanical Extracts.",
        benefits: "• Helps relieve physical fatigue and maintain hormonal balance in women.\n• Promotes blood purification, daily wellness, and natural skin glow.\n• Supports reproductive vitality and overall stamina.",
        how_to_use: "Mix 15-30 ml juice in a glass of water and consume 1-2 times daily."
    },
    {
        name: "Multi Vitamin Capsule (30 Tab.)",
        amount: 1499,
        pv: 300,
        image_url: "/images/logo.jpg",
        info: "Multi Vitamin Capsule delivers essential vitamins and minerals required by the body. It helps sustain energy, supports immune defenses, and boosts overall daily vitality.\n\nIngredients: Vitamin A, C, D3, E, B-Complex, Zinc, Magnesium, Mangosteen, Berries, and 20+ Vital Nutrients.",
        benefits: "• Provides essential daily vitamins and minerals for total wellness.\n• Supports active energy, stamina, and immune defenses.\n• Promotes active metabolic and physical performance.",
        how_to_use: "Take 1 capsule daily after a meal with water."
    },
    {
        name: "Maxx Power Capsule (30 Tab.)",
        amount: 1499,
        pv: 300,
        image_url: "/images/logo.jpg",
        info: "Maxx Power Capsule is a premium Ayurvedic supplement crafted to enhance strength, endurance, and physical vitality for an active lifestyle.\n\nIngredients: Ashwagandha, Safed Musli, Kaunch Beej, Akarkara, Gokshura, and Power Herbs Blend.",
        benefits: "• Enhances physical strength, stamina, and energy reserves.\n• Supports daily vitality, endurance, and performance.\n• Helps reduce stress and fatigue.",
        how_to_use: "Take 1 capsule daily after a meal with water or warm milk."
    },
    {
        name: "Detox Capsule (30 Cap.)",
        amount: 599,
        pv: 80,
        image_url: "/images/logo.jpg",
        info: "Avira LifeCare Detox Capsule is a premium dietary supplement that eliminates harmful toxins from the body (detoxification) and assists in deep liver cleansing and cellular rejuvenation.\n\nIngredients: Milk Thistle, Triphala, Kutki, Punarnava, Bhumi Amla, Dandelion Extract.",
        benefits: "• Supports the body's natural detoxification and cleansing process.\n• Promotes optimal liver function and digestive wellness.\n• Enhances healthy metabolism and gut balance.",
        how_to_use: "Take 1 capsule twice daily after meals with water."
    },
    {
        name: "Green Tea Tablet (30 Tab.)",
        amount: 799,
        pv: 110,
        image_url: "/images/logo.jpg",
        info: "Avira LifeCare Green Tea Tablet is a premium dietary supplement formulated to assist in healthy weight management and boost metabolism naturally.\n\nIngredients: Green Tea Extract, Grape Seed Ext., Lemon Dry Ext., Lemongrass Ext., Dalchini, Kalimirch.",
        benefits: "• Aids in natural weight management and calorie burning.\n• Supports enhanced metabolic rate and fat oxidation.\n• Delivers clean natural energy and potent antioxidant protection.",
        how_to_use: "Take 1 tablet twice daily after meals with water."
    },
    {
        name: "Fat Loss Capsule (30 Cap.)",
        amount: 799,
        pv: 110,
        image_url: "/images/logo.jpg",
        info: "Fat Loss Capsule is an advanced herbal dietary supplement formulated to support healthy weight management, fat metabolism, and an active lifestyle.\n\nIngredients: Garcinia Cambogia, Green Coffee Beans, Green Tea Extract, Ginseng Roots.",
        benefits: "• Helps support healthy weight management and appetite balance.\n• Boosts metabolic speed and fat breakdown.\n• Delivers best results when paired with balanced nutrition and regular exercise.",
        how_to_use: "Take 1 capsule twice daily 30 minutes before meals with water."
    },
    {
        name: "Women Special Powder (300 gm)",
        amount: 799,
        pv: 130,
        image_url: "/images/logo.jpg",
        info: "Women Special Powder is specially formulated keeping in mind women's unique nutritional requirements. It provides vital nutrients, sustains energy, and supports overall female vitality and strength.\n\nIngredients: Shatavari, Ashoka, Lodhra, Calcium, Iron, Folic Acid, and Essential Vitamins.",
        benefits: "• Nourishes women's health, enhances stamina, and supports daily wellness.\n• Fulfills essential micronutrient and mineral requirements (Iron, Calcium, Folic Acid).\n• Promotes hormonal and bone health.",
        how_to_use: "Mix 2-3 spoons of powder in warm milk or water and consume daily."
    },
    {
        name: "Diabetic Powder (200 gm)",
        amount: 799,
        pv: 110,
        image_url: "/images/logo.jpg",
        info: "Diabetic Powder is an authentic herbal dietary supplement formulated with potent traditional herbs to assist in maintaining healthy blood sugar balance alongside a healthy lifestyle.\n\nIngredients: Turmeric, Jamun, Harad, Baheda, Amla, Karela, Dalchini, Sunth, Paneer Phool, Methi, Kali Jiri, Gudmar, Neem Patra.",
        benefits: "• Helps in healthy blood sugar management and glycemic balance.\n• Supports healthy metabolism, pancreas function, and energy vitality.\n• Promotes optimal digestion and general well-being.",
        how_to_use: "Take 1 spoon (approx. 5g) with lukewarm water twice daily 30 minutes before meals."
    },
    {
        name: "Vanilla Protin Powder (300 gm)",
        amount: 799,
        pv: 130,
        image_url: "/images/logo.jpg",
        info: "Vanilla Protein Powder is packed with high-quality protein, ideal for muscle nourishment, post-workout recovery, and maintaining physical strength. Its delicious vanilla flavor makes it perfect for daily consumption.\n\nIngredients: Whey Protein Concentrate, Protein, DHA, Iron, Vitamin D3, and Vanilla Granules.",
        benefits: "• Provides high-quality protein for lean muscle development and nourishment.\n• Accelerates muscle recovery and builds physical stamina.\n• Easy to digest with essential micronutrients.",
        how_to_use: "Mix 2-3 spoons of powder in milk or water and consume 1-2 times daily."
    },
    {
        name: "Choco Brain Powder (250 gm)",
        amount: 599,
        pv: 100,
        image_url: "/images/logo.jpg",
        info: "Choco Brain Powder is specially crafted to support cognitive development, focus, and memory retention for growing children and youth. Combines rich chocolate taste with essential brain nourishment.\n\nIngredients: Shankhpushpi, Brahmi, Ashwagandha, Almond Extracts, and Cocoa Solids.",
        benefits: "• Supports mental alertness, memory recall, and cognitive nourishment.\n• Delicious, nutritious chocolate drink for kids and young adults.\n• Promotes sustained focus and learning ability.",
        how_to_use: "Mix 1-2 spoons in warm milk and consume 1-2 times daily."
    },
    {
        name: "Pineapple Energy Booster (300 gm)",
        amount: 599,
        pv: 100,
        image_url: "/images/logo.jpg",
        info: "Pineapple Energy Booster provides instant energetic revitalization and refreshing hydration. Helps eliminate fatigue, keeping you active, hydrated, and energetic throughout the day.\n\nIngredients: Dextrose, Sucrose, Zinc, Vitamin C, and Natural Pineapple Extracts.",
        benefits: "• Delivers immediate energy, electrolytes, and refreshing vigor.\n• Helps reduce fatigue, exhaustion, and dehydration.\n• Instant refreshing pineapple flavor.",
        how_to_use: "Mix required quantity in cold or normal water and consume as needed."
    },
    {
        name: "Jeevan Amrut Drops (30 ml)",
        amount: 599,
        pv: 100,
        image_url: "/images/logo.jpg",
        info: "Jeevan Amrut Drops is a powerful wellness formula made from concentrated Ayurvedic herbs. It boosts the body's natural defense mechanism and promotes complete holistic wellness.\n\nIngredients: Panch Tulsi Extract, Giloy, Curcumin, Ginger, and Cinnamon Oil.",
        benefits: "• Concentrated herbal immunity booster enriched with Panch Tulsi & Curcumin.\n• Fortifies the immune system, respiratory defense, and overall health.\n• Protects against seasonal environmental changes.",
        how_to_use: "Mix 2-3 drops in a glass of water, tea, or juice and take twice daily."
    },
    {
        name: "Avira De-Addiction (100 ml)",
        amount: 799,
        pv: 125,
        image_url: "/uploads/1784486181905-778964644-DE-ADDICTION.jpeg",
        info: "Avira De-Addiction is an Ayurvedic formulation developed to support the body and mind in quitting harmful substance habits and cravings. Helps calm the nervous system and restore mental balance.\n\nIngredients: Vidarikand, Ashwagandha, Brahmi, Jyotishmati, and Arjuna Bark Extract.",
        benefits: "• Aids in reducing cravings and supports the recovery process from harmful habits.\n• Supports mental stability, nervous system relaxation, and emotional balance.\n• 100% natural, safe, and non-addictive formulation.",
        how_to_use: "Mix 5-6 drops in water, juice, or food twice daily or as advised."
    },
    {
        name: "Neemadent Toothpaste (150 gm)",
        amount: 129,
        pv: 15,
        image_url: "/images/logo.jpg",
        info: "Neemadent Toothpaste is enriched with pure neem and traditional Ayurvedic herbs that maintain complete oral hygiene for teeth and gums. Regular brushing provides long-lasting freshness and cavity protection.\n\nIngredients: Neem Extracts, Clove Oil, Babool, Majuphal, and Mint Crystals.",
        benefits: "• Provides effective plaque removal and strengthens gums and teeth.\n• Keeps breath fresh and delivers comprehensive daily oral protection.\n• Fights tooth decay and gum sensitivity.",
        how_to_use: "Brush thoroughly at least twice daily for 2 minutes."
    },
    {
        name: "Japanese Massage Cream (100 gm)",
        amount: 199,
        pv: 20,
        image_url: "/images/logo.jpg",
        info: "Japanese Massage Cream is specially formulated for body massage and relief. Its smooth formula spreads effortlessly on the skin to provide a soothing, relaxing massage experience that eases tension.\n\nIngredients: Eucalyptus Oil, Camphor, Sesame Oil, Menthol, Cream Base.",
        benefits: "• Provides deeply relaxing and rejuvenating sensations during body massage.\n• Keeps skin soft, nourished, and makes massage effortless.\n• Relieves physical stiffness and muscle fatigue.",
        how_to_use: "Apply an adequate quantity on the affected area and massage gently with soft circular motions."
    },
    {
        name: "Premium Tea Leaves (250 gm)",
        amount: 349,
        pv: 40,
        image_url: "/images/logo.jpg",
        info: "Premium Tea Leaves are crafted from hand-picked, premium-grade tea leaves from renowned Dooars and Assam gardens. Every cup delivers rich color, exquisite taste, and authentic aroma.\n\nIngredients: 100% Pure Blend of Tea Leaves from Gardens of Dooars and Assam.",
        benefits: "• Superior taste, fresh briskness, and natural rich tea aroma.\n• Makes every cup of chai more flavorful, revitalizing, and delightful.\n• 100% pure authentic leaf selection.",
        how_to_use: "Add the required quantity to boiling water, add milk and sugar to taste, and simmer."
    },
    {
        name: "Avira Sanitary Napkins (8 Pads)",
        amount: 125,
        pv: 20,
        image_url: "/images/logo.jpg",
        info: "Avira Sanitary Napkins offer superior comfort and leak protection during menstrual cycles. Made with a natural organic cotton top sheet that prevents skin rashes, itching, and irritation.\n\nIngredients: 100% Natural Organic Cotton, Anion Chip, Gel Core Absorption Layer, Breathable Back Sheet.",
        benefits: "• Super-lock absorption pockets that easily absorb heavy flow without leaks.\n• Anion strip and breathable gel core technology for maximum hygiene and odor control.\n• Soft, comfortable, and skin-friendly design.",
        how_to_use: "Use as per instructions on the pack during menstrual cycle."
    },
    {
        name: "Niacinamide Facewash (100 gm)",
        amount: 399,
        pv: 55,
        image_url: "/images/logo.jpg",
        info: "Niacinamide Face Wash deeply cleanses pores, removes excess sebum, environmental dirt, and impurities. It leaves the skin looking fresh, radiant, clear, and visibly healthy.\n\nIngredients: Niacinamide (Vitamin B3), Avocado Extract, Aloe Vera, and Mild Cleansers.",
        benefits: "• Deeply purifies skin, controls excess oil, and clears trapped impurities.\n• Imparts instant freshness and natural radiant glow.\n• Balances moisture without drying out the skin.",
        how_to_use: "Apply on wet face, massage gently in circular motions for 2 minutes, and rinse thoroughly with clean water."
    },
    {
        name: "5 IN 1 Facewash (100 gm)",
        amount: 299,
        pv: 30,
        image_url: "/images/logo.jpg",
        info: "5 IN 1 Face Wash is an all-in-one facial skincare solution for deep cleansing, oil control, long-lasting freshness, intense hydration, and natural skin glow.\n\nIngredients: Cinnamon, Tulsi, Aloe Vera, Neem Extract, and Lemon Peel.",
        benefits: "• 5-in-1 action: Deep Cleansing, Oil Control, Freshness, Hydration, and Radiant Glow.\n• Regular daily use keeps facial skin fresh, silky smooth, and blemish-free.\n• Gentle daily botanical formula.",
        how_to_use: "Apply onto damp face, gently massage in circular motions, and wash off with clean water."
    },
    {
        name: "Salicylic Acid Face Cleanser (100 ml)",
        amount: 699,
        pv: 110,
        image_url: "/images/logo.jpg",
        info: "Salicylic Acid Face Cleanser deeply cleanses into the pores to exfoliate dead skin cells, remove excess oil, and unclog pores. Ideal for maintaining clear, balanced, and acne-free skin.\n\nIngredients: Salicylic Acid, Niacinamide, Tea Tree Oil, and Aloe Vera.",
        benefits: "• Deep pore cleansing to remove stubborn oil, dirt, and breakout-causing bacteria.\n• Keeps skin clean, balanced, and soothed without overdrying.\n• Smooths skin texture and reduces blemishes.",
        how_to_use: "Apply to damp face, massage gently with soft hands, and rinse thoroughly with water."
    },
    {
        name: "Avira Night Cream (50 gm)",
        amount: 599,
        pv: 100,
        image_url: "/images/logo.jpg",
        info: "Avira Night Cream is formulated to provide deep nocturnal hydration and intense cellular nourishment while you sleep. Regular use makes skin visibly smoother, brighter, and naturally luminous.\n\nIngredients: Aqua, Glycerin, Niacinamide, Arbutin, Kojic Acid, Hyaluronic Acid, Licorice Extract, Allantoin.",
        benefits: "• Delivers overnight hydration, moisture barrier repair, and intensive skin nourishment.\n• Helps diminish dark spots, improving skin tone for a youthful, supple glow.\n• Promotes smooth, luminous, and radiant skin texture.",
        how_to_use: "Cleanse face thoroughly at night, apply a small quantity evenly over face and neck, and massage gently until absorbed."
    },
    {
        name: "Neem Tulsi Soap (100 gm)",
        amount: 99,
        pv: 12,
        image_url: "/images/logo.jpg",
        info: "Avira Neem Tulsi Soap gently cleanses the skin while imparting softness, purification, and natural herbal fragrance. Its antibacterial herbal formula keeps skin clean, soft, and protected.\n\nIngredients: Pure Glycerin Base, Neem Oil Extract, Tulsi Essential Oil, Natural Moisturizers.",
        benefits: "• Keeps skin soft, refreshed, and fragrant with authentic herbal aroma.\n• Purifies skin and protects against daily environmental impurities.\n• Gentle glycerin base suitable for daily whole-body use.",
        how_to_use: "Lather well over wet body during bath and rinse thoroughly with clean water."
    },
    {
        name: "Rose Geranium Soap (100 gm)",
        amount: 99,
        pv: 12,
        image_url: "/images/logo.jpg",
        info: "Avira Rose Geranium Soap provides deep hydration and a rich, luxurious floral aroma during bathing, keeping your skin silky smooth and delightfully fragrant.\n\nIngredients: Fine Glycerine Soap Base, Rose Geranium Essential Extract, Natural Moisturizing Oils.",
        benefits: "• Softens, hydrates, and deeply moisturizes skin with a luxurious rose aroma.\n• Leaves skin glowing, smooth, and supple.\n• Rich creamy lather for a spa-like bath experience.",
        how_to_use: "Lather gently onto damp body during shower and rinse clean with water."
    },
    {
        name: "Lavender Soap (100 gm)",
        amount: 99,
        pv: 12,
        image_url: "/images/logo.jpg",
        info: "Avira Lavender Soap offers a calming, soothing bathing experience that cleanses away dirt while relaxing the senses with calming lavender notes.\n\nIngredients: Fine Glycerine Soap Base, Lavender Essential Oil, Botanical Skin Conditioners.",
        benefits: "• Calms, refreshes, and gently hydrates the skin.\n• Rich creamy lather leaves skin velvety soft and soothingly scented.\n• Perfect for evening baths to ease daily stress.",
        how_to_use: "Use daily during bath or shower for a refreshing, calming cleanse."
    },
    {
        name: "Sleepy Soap (100 gm)",
        amount: 99,
        pv: 12,
        image_url: "/images/logo.jpg",
        info: "Avira Sleepy Soap is a specialized relaxing bath bar crafted with soothing aromatics designed to wash away evening fatigue and prepare you for restful slumber.\n\nIngredients: Fine Glycerine Base, Chamomile & Lavender Calming Extracts, Natural Oils.",
        benefits: "• Provides a deeply tranquil, relaxing bath experience after a long tiring day.\n• Keeps skin gently cleansed, hydrated, and soft.\n• Infused with relaxing botanical essences.",
        how_to_use: "Use during evening shower or bath and rinse thoroughly."
    },
    {
        name: "Daily Body Wash (300 ml)",
        amount: 499,
        pv: 80,
        image_url: "/images/logo.jpg",
        info: "Daily Moisturizing Body Wash cleanses deep within while providing long-lasting moisture and refreshing vitality. Its gentle formula keeps skin silky soft, hydrated, and glowing.\n\nIngredients: Aloe Vera, Shea Butter, Glycerin, Coconut Oil base, and Vitamin E.",
        benefits: "• Cleanses deeply while locking in essential hydration for all-day skin softness.\n• Leaves skin feeling refreshed, radiant, and silky smooth after every shower.\n• Gentle sulfate-free daily nourishing wash.",
        how_to_use: "Apply onto wet body or loofah, lather gently across skin, and rinse off with water."
    },
    {
        name: "34 Herbs Hair Oil (100 ml)",
        amount: 499,
        pv: 90,
        image_url: "/images/logo.jpg",
        info: "34 Herbs Hair Oil is a nutrient-rich regrowth hair oil formulated with authentic Ayurvedic herbs. It deeply nourishes hair roots, strengthens follicles, and promotes healthy hair growth. Regular use makes hair thicker, softer, and lustrous.\n\nIngredients: Bhringraj, Amla, Sesame Oil, Coconut Oil, Brahmi, Jatamansi, Tea Tree Oil.",
        benefits: "• Nourishes hair follicles at the roots to significantly strengthen hair and reduce breakage.\n• Enhances natural shine, volume, and healthy hair growth.\n• Promotes deep relaxation when massaged onto scalp.",
        how_to_use: "Apply on scalp and hair 1-2 hours before washing or leave overnight, gently massage for 5-10 minutes."
    },
    {
        name: "Red Onion Hair Oil (100 ml)",
        amount: 399,
        pv: 50,
        image_url: "/images/logo.jpg",
        info: "Red Onion Hair Oil is rich in the natural goodness of red onion and sulfur-rich seed oils that nourish follicles, combat hair fall, and support robust hair vitality and strength.\n\nIngredients: Red Onion Seed Oil, Black Seed Oil, Argan Oil, Jojoba Oil, Almond Oil, Castor Oil.",
        benefits: "• Nourishes hair roots to minimize hair fall and encourage strong follicle growth.\n• Imparts silkiness, shine, and thickness to dry or damaged hair.\n• Non-sticky lightweight formula with pleasant fragrance.",
        how_to_use: "Apply thoroughly onto scalp, massage gently with fingertips, leave for a few hours or overnight, and wash with shampoo."
    },
    {
        name: "24 Herbs Shampoo (300 ml)",
        amount: 499,
        pv: 100,
        image_url: "/uploads/1784490978350-374974416-24_HERBS_SHAMPOO.jpeg",
        info: "24 Herbs Ayurvedic Shampoo is crafted with potent traditional botanicals. It cleanses hair and scalp deeply, strengthening hair strands from roots to tips while keeping them soft, bouncy, and healthy.\n\nIngredients: Amla, Reetha, Shikakai, Neem, Bhringraj, Aloe Vera, and 18+ Herbs Blend.",
        benefits: "• Deeply cleanses hair and scalp of dirt, grease, and excess sebum.\n• Leaves hair noticeably softer, stronger, and full of natural luster.\n• Helps reduce hair fall and split ends.",
        how_to_use: "Apply to wet hair, gently massage scalp and strands, and rinse thoroughly with clean water."
    },
    {
        name: "Milky Shampoo (300 ml)",
        amount: 499,
        pv: 100,
        image_url: "/images/logo.jpg",
        info: "Milky Shampoo deeply cleanses hair while infusing intense softness, gloss, and nourishment. Its nutrient-rich milk protein and keratin formula protects hair against dryness, frizz, and breakage.\n\nIngredients: Milk Protein, Aloe Vera, Vitamin E, Hydrolyzed Keratin, and Moisturizers.",
        benefits: "• Cleanses deeply while leaving hair silky soft, lustrous, and nourished.\n• Helps repair split ends, eliminates frizz, and restores natural hair beauty.\n• Restores natural moisture and volume.",
        how_to_use: "Apply to wet hair, massage gently for 2-3 minutes, and rinse thoroughly with water."
    },
    {
        name: "Tea Tree Shampoo (300 ml)",
        amount: 399,
        pv: 50,
        image_url: "/images/logo.jpg",
        info: "Tea Tree Shampoo is enriched with the clarifying power of natural tea tree oil and herbs. It purifies the scalp, combats dandruff and excess oiliness, keeping hair fresh, strong, and revitalized.\n\nIngredients: Tea Tree Oil, Neem Extract, Birch Extract, Rosemary, and Aloe Vera.",
        benefits: "• Deeply purifies scalp, removes excess oil, flakes, and build-up.\n• Provides cooling freshness and natural root strength.\n• Keeps hair clean, voluminous, and lightweight.",
        how_to_use: "Apply onto wet hair, massage gently into scalp, and rinse thoroughly with water."
    },
    {
        name: "Black Mahendi Powder (25 gm)",
        amount: 120,
        pv: 15,
        image_url: "/images/logo.jpg",
        info: "Black Mahendi Powder is formulated from authentic herbal ingredients that impart a rich, natural black color to hair while preserving its natural shine, softness, and texture.\n\nIngredients: Henna 75%, Amla 5.0%, Alum 3.0%, Reetha 4.0%, Fenugreek 3.0%, Brahmi 3.0%, Sodium Lauryl Sulfate 2.0%, Jatamansi Powder 2.0%, Bavchi Powder 3.0%.",
        benefits: "• Imparts rich, natural black color and radiant sheen to hair.\n• Keeps hair soft, conditioned, and voluminous.\n• Ammonia-free herbal conditioning powder.",
        how_to_use: "Mix with water to form a smooth paste, apply evenly onto hair, leave for 50-60 minutes, and rinse thoroughly with water."
    },
    {
        name: "Brown Mahendi Powder (25 gm)",
        amount: 120,
        pv: 15,
        image_url: "/images/logo.jpg",
        info: "Brown Mahendi Powder is prepared to give hair a beautiful, rich natural brown tone and lustrous shine. Its herbal conditioning formula maintains hair vitality and softness.\n\nIngredients: Henna 75%, Amla 5.0%, Alum 3.0%, Reetha 4.0%, Fenugreek 3.0%, Brahmi 3.0%, Sodium Lauryl Sulfate 2.0%, Jatamansi Powder 2.0%, Bavchi Powder 3.0%.",
        benefits: "• Imparts a natural, rich brown tone and healthy gloss to hair.\n• Nourishes strands to leave them soft, smooth, and conditioned.\n• Safe, gentle, and herbal-rich formulation.",
        how_to_use: "Mix with water to make a smooth paste, apply evenly onto hair, leave for 50-60 minutes, and rinse thoroughly with water."
    },
    {
        name: "Herbal Wax Powder (100 gm)",
        amount: 499,
        pv: 100,
        image_url: "/images/logo.jpg",
        info: "Herbal Wax Powder is a natural and effective solution for painless hair removal. Its gentle herbal formulation preserves skin softness while delivering a smooth, hair-free finish in just 10 minutes.\n\nIngredients: Fullers Earth (Multani Mitti), Aloe Vera, Turmeric, Sandalwood, Boswellia, Perfume.",
        benefits: "• Helps remove unwanted body hair painlessly and effectively.\n• Leaves skin clean, soft, smooth, and radiant without irritation.\n• Quick 10-minute application with soothing herbal aroma.",
        how_to_use: "Mix with water to prepare a paste, apply onto desired area, let it dry for 10 minutes, and wipe clean with a wet cloth."
    },
    {
        name: "Avira Bloom + (100 ml)",
        amount: 415,
        pv: 40,
        image_url: "/images/logo.jpg",
        info: "Avira Bloom+ is a specialized plant tonic formulated to stimulate flowering and fruit development in crops. It prevents flower shedding and accelerates the fruit setting process.\n\nIngredients: Amino Acids & Peptides, Potassium & Phosphorus Enriched Extracts, Flowering Stimulating Enzymes.",
        benefits: "• Stimulates abundant, healthy flowering and budding in plants.\n• Prevents premature flower drop and enhances fruit set ratio.\n• Improves overall crop vigor and productivity.",
        how_to_use: "Foliar Spray: 10 ml per 15 liters of water."
    },
    {
        name: "Avira Bloom + (250 ml)",
        amount: 810,
        pv: 100,
        image_url: "/images/logo.jpg",
        info: "Avira Bloom+ is a specialized plant tonic formulated to boost flowering and fruit formation in agricultural crops. It prevents flower drop and dramatically improves crop yield, size, and flavor.\n\nIngredients: Amino Acids & Peptides, Potassium & Phosphorus Enriched Extracts, Flowering Stimulating Enzymes.",
        benefits: "• Promotes prolific, healthy flowering and bud formation.\n• Prevents flower dropping and improves fruit setting.\n• Enhances fruit size, color, taste, and overall crop yield.",
        how_to_use: "Foliar Spray: 25 ml per 15 liters of water."
    },
    {
        name: "Plant Growth Promoter (250 ml)",
        amount: 375,
        pv: 40,
        image_url: "/images/logo.jpg",
        info: "Plant Growth Promoter is a specialized blend of humic, fulvic, amino acids, and seaweed extracts that accelerates seed germination, strengthens plant growth, and enhances photosynthesis.\n\nIngredients: Bio-stimulants, Essential Micronutrients, Organic Growth Enzymes & Amino Acids.",
        benefits: "• Accelerates seed germination and builds strong, resilient crop growth.\n• Activates photosynthetic activity to keep crops lush green and vigorous.\n• Significantly increases total agricultural yield and quality.",
        how_to_use: "Foliar Spray: 20 ml per 15 liters of water. Drenching: 40 ml per 15 liters of water."
    },
    {
        name: "Avira 82ST (100 ml)",
        amount: 440,
        pv: 40,
        image_url: "/images/logo.jpg",
        info: "FT-82 is a non-ionic silicone spreader, sticker, penetrant, and activator that can be combined with any organic or chemical agricultural spray to maximize efficiency and coverage.\n\nIngredients: Bio-stimulants, Essential Micronutrients, Organic Growth Enzymes & Amino Acids.",
        benefits: "• Significantly boosts the effectiveness and penetration of agricultural sprays.\n• Ensures rapid, uniform spreading on leaves and prevents wash-off during rain.\n• Improves crop quality and reduces wastage of fertilizers/pesticides.",
        how_to_use: "Spray: 5 ml per 15 liters of water. Drenching: 1-2 ml per liter of water."
    },
    {
        name: "Avira 82ST (250 ml)",
        amount: 715,
        pv: 80,
        image_url: "/images/logo.jpg",
        info: "FT-82 is a non-ionic sticker, spreader, penetrant, and activator designed to be mixed with any organic or chemical crop spray for enhanced coverage and prolonged efficacy.\n\nIngredients: Bio-stimulants, Essential Micronutrients, Organic Growth Enzymes & Amino Acids.",
        benefits: "• Highly effective in enhancing spray performance across all crop types.\n• Aids fast, even spreading and long-lasting adherence on foliage.\n• Improves overall crop health, yield quality, and cost efficiency.",
        how_to_use: "Spray: 5 ml per 15 liters of water. Drenching: 1-2 ml per liter of water."
    },
    {
        name: "Bhumi Sanjivani (250 gm)",
        amount: 625,
        pv: 60,
        image_url: "/images/logo.jpg",
        info: "Bhumi Sanjivani is an advanced soil conditioner that supplies essential nutrients to plants, reduces soil salinity/alkalinity, and transforms hard compacted soil into fertile, porous living soil.\n\nIngredients: Bio-stimulants, Essential Micronutrients, Organic Growth Enzymes & Amino Acids.",
        benefits: "• Reduces soil salinity and restores optimal soil structure and fertility.\n• Multiplies white feeder root growth to maximize nutrient and moisture uptake.\n• Converts hard, compacted soil into rich, productive fertile soil.",
        how_to_use: "Drenching / Broadcasting: 250 gm per 1 Acre (10-15 gm per 15 liters of water)."
    }
];

async function seedProducts() {
    console.log(`🌿 Seeding ${products.length} Avira Lifecare products in English...`);

    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');

        for (const p of products) {
            const checkRes = await client.query('SELECT id FROM avira_products WHERE UPPER(name) = UPPER($1)', [p.name]);
            if (checkRes.rows.length === 0) {
                const insertSql = `
                    INSERT INTO avira_products (name, amount, pv, info, benefits, how_to_use, image_url, all_images)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `;
                const allImagesJson = JSON.stringify([p.image_url]);
                await client.query(insertSql, [
                    p.name,
                    p.amount,
                    p.pv,
                    p.info,
                    p.benefits,
                    p.how_to_use,
                    p.image_url,
                    allImagesJson
                ]);
                console.log(`  ➕ Added: ${p.name} (₹${p.amount} | ${p.pv} PV)`);
            } else {
                console.log(`  ⏭️ Skipped (already exists): ${p.name}`);
            }
        }

        await client.query('COMMIT');
        console.log('✅ All products successfully seeded in English!');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error seeding products:', err);
    } finally {
        client.release();
        process.exit(0);
    }
}

seedProducts();
