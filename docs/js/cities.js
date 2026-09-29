// Waypoint catalogue. Codes are 3-letter callsigns (IATA-style where one exists).
// hint feeds the render prompt so each still gets recognisable scenery.

const C = (code, name, country, lat, lon, tz, cur, hint = '', wiki = name) => ({ code, name, country, lat, lon, tz, cur, hint, wiki });

export const CITIES = [
  // Europe & Atlantic
  C('LIS', 'Lisbon', 'Portugal', 38.7223, -9.1393, 'Europe/Lisbon', 'EUR', 'terracotta rooftops of Alfama, the 25 de Abril bridge over the Tagus'),
  C('OPO', 'Porto', 'Portugal', 41.1579, -8.6291, 'Europe/Lisbon', 'EUR', 'Ribeira riverfront, Dom Luís I iron bridge over the Douro'),
  C('FNC', 'Funchal', 'Portugal', 32.6669, -16.9241, 'Atlantic/Madeira', 'EUR', 'volcanic cliffs of Madeira, terraced hillsides above the Atlantic'),
  C('PDL', 'Ponta Delgada', 'Portugal', 37.7412, -25.6756, 'Atlantic/Azores', 'EUR', 'Azores crater lakes of Sete Cidades, emerald calderas'),
  C('MAD', 'Madrid', 'Spain', 40.4168, -3.7038, 'Europe/Madrid', 'EUR', 'Gran Vía domes and Plaza Mayor'),
  C('BCN', 'Barcelona', 'Spain', 41.3874, 2.1686, 'Europe/Madrid', 'EUR', 'Sagrada Família spires and the Eixample grid'),
  C('TFS', 'Tenerife', 'Spain', 28.2916, -16.6291, 'Atlantic/Canary', 'EUR', 'Mount Teide volcano above a sea of clouds'),
  C('PAR', 'Paris', 'France', 48.8566, 2.3522, 'Europe/Paris', 'EUR', 'Eiffel Tower and Haussmann boulevards along the Seine'),
  C('LON', 'London', 'United Kingdom', 51.5072, -0.1276, 'Europe/London', 'GBP', 'the Thames, Tower Bridge and the City skyline'),
  C('EDI', 'Edinburgh', 'United Kingdom', 55.9533, -3.1883, 'Europe/London', 'GBP', 'Edinburgh Castle on its volcanic crag, Old Town spires'),
  C('DUB', 'Dublin', 'Ireland', 53.3498, -6.2603, 'Europe/Dublin', 'EUR', 'River Liffey bridges and Georgian terraces'),
  C('AMS', 'Amsterdam', 'Netherlands', 52.3676, 4.9041, 'Europe/Amsterdam', 'EUR', 'concentric canals lined with gabled houses'),
  C('BER', 'Berlin', 'Germany', 52.52, 13.405, 'Europe/Berlin', 'EUR', 'Fernsehturm TV tower and the Spree'),
  C('PRG', 'Prague', 'Czechia', 50.0755, 14.4378, 'Europe/Prague', 'CZK', 'Charles Bridge and Prague Castle over the Vltava'),
  C('VIE', 'Vienna', 'Austria', 48.2082, 16.3738, 'Europe/Vienna', 'EUR', 'St. Stephen\'s Cathedral and the Ringstrasse'),
  C('ZRH', 'Zurich', 'Switzerland', 47.3769, 8.5417, 'Europe/Zurich', 'CHF', 'Lake Zurich with the Alps on the horizon'),
  C('ROM', 'Rome', 'Italy', 41.9028, 12.4964, 'Europe/Rome', 'EUR', 'the Colosseum and domes of the historic centre'),
  C('VCE', 'Venice', 'Italy', 45.4408, 12.3155, 'Europe/Rome', 'EUR', 'Grand Canal, gondolas and St. Mark\'s Basilica'),
  C('ATH', 'Athens', 'Greece', 37.9838, 23.7275, 'Europe/Athens', 'EUR', 'the Acropolis and Parthenon above the city'),
  C('JTR', 'Santorini', 'Greece', 36.3932, 25.4615, 'Europe/Athens', 'EUR', 'white cubic houses and blue domes on the caldera cliffs'),
  C('IST', 'Istanbul', 'Türkiye', 41.0082, 28.9784, 'Europe/Istanbul', 'TRY', 'minarets of the Blue Mosque and the Bosphorus'),
  C('CPH', 'Copenhagen', 'Denmark', 55.6761, 12.5683, 'Europe/Copenhagen', 'DKK', 'colourful Nyhavn harbour'),
  C('OSL', 'Oslo', 'Norway', 59.9139, 10.7522, 'Europe/Oslo', 'NOK', 'Oslofjord and the angular Opera House'),
  C('STO', 'Stockholm', 'Sweden', 59.3293, 18.0686, 'Europe/Stockholm', 'SEK', 'Gamla Stan islands and waterways'),
  C('HEL', 'Helsinki', 'Finland', 60.1699, 24.9384, 'Europe/Helsinki', 'EUR', 'Helsinki Cathedral and the Baltic archipelago'),
  C('REK', 'Reykjavík', 'Iceland', 64.1466, -21.9426, 'Atlantic/Reykjavik', 'ISK', 'Hallgrímskirkja church, aurora borealis over volcanic landscape'),
  C('LYR', 'Longyearbyen', 'Svalbard', 78.2232, 15.6267, 'Arctic/Longyearbyen', 'NOK', 'arctic glaciers and snow-covered peaks under polar twilight'),
  // Middle East & Africa
  C('DXB', 'Dubai', 'UAE', 25.2048, 55.2708, 'Asia/Dubai', 'AED', 'Burj Khalifa piercing a futuristic desert skyline'),
  C('DOH', 'Doha', 'Qatar', 25.2854, 51.531, 'Asia/Qatar', 'QAR', 'West Bay towers along the corniche'),
  C('AMM', 'Amman', 'Jordan', 31.9454, 35.9284, 'Asia/Amman', 'JOD', 'limestone city on hills, Petra canyons beyond'),
  C('TLV', 'Tel Aviv', 'Israel', 32.0853, 34.7818, 'Asia/Jerusalem', 'ILS', 'Mediterranean beachfront and Bauhaus white city'),
  C('CAI', 'Cairo', 'Egypt', 30.0444, 31.2357, 'Africa/Cairo', 'EGP', 'the Giza pyramids at the edge of the megacity'),
  C('RAK', 'Marrakech', 'Morocco', 31.6295, -7.9811, 'Africa/Casablanca', 'MAD', 'Koutoubia minaret, red medina walls, Atlas mountains', 'Marrakesh'),
  C('LOS', 'Lagos', 'Nigeria', 6.5244, 3.3792, 'Africa/Lagos', 'NGN', 'Lagos lagoon and Victoria Island skyline'),
  C('NBO', 'Nairobi', 'Kenya', -1.2921, 36.8219, 'Africa/Nairobi', 'KES', 'savannah wildlife with the city skyline behind'),
  C('ZNZ', 'Zanzibar', 'Tanzania', -6.1659, 39.2026, 'Africa/Dar_es_Salaam', 'TZS', 'dhow sails on turquoise water, Stone Town'),
  C('JNB', 'Johannesburg', 'South Africa', -26.2041, 28.0473, 'Africa/Johannesburg', 'ZAR', 'Hillbrow tower and highveld skyline'),
  C('CPT', 'Cape Town', 'South Africa', -33.9249, 18.4241, 'Africa/Johannesburg', 'ZAR', 'Table Mountain above the city and Atlantic coast'),
  C('MRU', 'Mauritius', 'Mauritius', -20.1609, 57.5012, 'Indian/Mauritius', 'MUR', 'Le Morne peninsula and lagoon reefs'),
  C('SEZ', 'Seychelles', 'Seychelles', -4.6191, 55.4513, 'Indian/Mahe', 'SCR', 'granite boulders on white-sand beaches'),
  // Asia
  C('DEL', 'Delhi', 'India', 28.6139, 77.209, 'Asia/Kolkata', 'INR', 'India Gate and Mughal domes in golden haze'),
  C('BOM', 'Mumbai', 'India', 19.076, 72.8777, 'Asia/Kolkata', 'INR', 'Marine Drive curve and Gateway of India'),
  C('KTM', 'Kathmandu', 'Nepal', 27.7172, 85.324, 'Asia/Kathmandu', 'NPR', 'Boudhanath stupa with the Himalaya behind'),
  C('CMB', 'Colombo', 'Sri Lanka', 6.9271, 79.8612, 'Asia/Colombo', 'LKR', 'tropical coastline and Lotus Tower'),
  C('MLE', 'Malé', 'Maldives', 4.1755, 73.5093, 'Indian/Maldives', 'MVR', 'overwater villas above a turquoise atoll'),
  C('ALA', 'Almaty', 'Kazakhstan', 43.222, 76.8512, 'Asia/Almaty', 'KZT', 'Tian Shan snow peaks above the city'),
  C('ULN', 'Ulaanbaatar', 'Mongolia', 47.8864, 106.9057, 'Asia/Ulaanbaatar', 'MNT', 'steppe grasslands and nomad gers'),
  C('BKK', 'Bangkok', 'Thailand', 13.7563, 100.5018, 'Asia/Bangkok', 'THB', 'Wat Arun temple on the Chao Phraya river'),
  C('REP', 'Siem Reap', 'Cambodia', 13.3671, 103.8448, 'Asia/Phnom_Penh', 'KHR', 'Angkor Wat towers reflected in the moat'),
  C('HAN', 'Hanoi', 'Vietnam', 21.0278, 105.8342, 'Asia/Ho_Chi_Minh', 'VND', 'Ha Long Bay limestone karsts in mist'),
  C('SIN', 'Singapore', 'Singapore', 1.3521, 103.8198, 'Asia/Singapore', 'SGD', 'Marina Bay Sands and Supertree Grove at night'),
  C('KUL', 'Kuala Lumpur', 'Malaysia', 3.139, 101.6869, 'Asia/Kuala_Lumpur', 'MYR', 'Petronas Twin Towers glowing at dusk'),
  C('DPS', 'Bali', 'Indonesia', -8.6705, 115.2126, 'Asia/Makassar', 'IDR', 'rice terraces and volcanic peaks'),
  C('MNL', 'Manila', 'Philippines', 14.5995, 120.9842, 'Asia/Manila', 'PHP', 'Manila Bay sunset and El Nido lagoons'),
  C('HKG', 'Hong Kong', 'Hong Kong', 22.3193, 114.1694, 'Asia/Hong_Kong', 'HKD', 'Victoria Harbour skyline with neon reflections'),
  C('TPE', 'Taipei', 'Taiwan', 25.033, 121.5654, 'Asia/Taipei', 'TWD', 'Taipei 101 above misty mountains'),
  C('SHA', 'Shanghai', 'China', 31.2304, 121.4737, 'Asia/Shanghai', 'CNY', 'Pudong skyline across the Bund'),
  C('PEK', 'Beijing', 'China', 39.9042, 116.4074, 'Asia/Shanghai', 'CNY', 'Forbidden City roofs, the Great Wall beyond'),
  C('SEL', 'Seoul', 'South Korea', 37.5665, 126.978, 'Asia/Seoul', 'KRW', 'Namsan Tower above a sea of city lights'),
  C('TYO', 'Tokyo', 'Japan', 35.6762, 139.6503, 'Asia/Tokyo', 'JPY', 'neon-lit Shinjuku skyline, Mount Fuji on the horizon'),
  C('UKY', 'Kyoto', 'Japan', 35.0116, 135.7681, 'Asia/Tokyo', 'JPY', 'Fushimi Inari torii gates and temple pagodas'),
  // Oceania & Pacific
  C('SYD', 'Sydney', 'Australia', -33.8688, 151.2093, 'Australia/Sydney', 'AUD', 'Opera House sails and Harbour Bridge'),
  C('MEL', 'Melbourne', 'Australia', -37.8136, 144.9631, 'Australia/Melbourne', 'AUD', 'Yarra river skyline and laneways'),
  C('CNS', 'Cairns', 'Australia', -16.9186, 145.7781, 'Australia/Brisbane', 'AUD', 'Great Barrier Reef from the air'),
  C('AKL', 'Auckland', 'New Zealand', -36.8509, 174.7645, 'Pacific/Auckland', 'NZD', 'Sky Tower and volcanic harbour islands'),
  C('ZQN', 'Queenstown', 'New Zealand', -45.0312, 168.6626, 'Pacific/Auckland', 'NZD', 'the Remarkables range above Lake Wakatipu, Milford Sound fjords', 'Queenstown, New Zealand'),
  C('PPT', 'Tahiti', 'French Polynesia', -17.5516, -149.5585, 'Pacific/Tahiti', 'XPF', 'Bora Bora lagoon and Mount Otemanu', 'Tahiti'),
  C('HNL', 'Honolulu', 'USA', 21.3069, -157.8583, 'Pacific/Honolulu', 'USD', 'Diamond Head crater above Waikiki', 'Honolulu'),
  // Americas
  C('ANC', 'Anchorage', 'USA', 61.2181, -149.9003, 'America/Anchorage', 'USD', 'Chugach mountains and glaciers', 'Anchorage, Alaska'),
  C('YVR', 'Vancouver', 'Canada', 49.2827, -123.1207, 'America/Vancouver', 'CAD', 'glass towers between ocean and North Shore mountains'),
  C('SEA', 'Seattle', 'USA', 47.6062, -122.3321, 'America/Los_Angeles', 'USD', 'Space Needle with Mount Rainier behind'),
  C('SFO', 'San Francisco', 'USA', 37.7749, -122.4194, 'America/Los_Angeles', 'USD', 'Golden Gate Bridge emerging from fog'),
  C('LAX', 'Los Angeles', 'USA', 34.0522, -118.2437, 'America/Los_Angeles', 'USD', 'endless city grid, Hollywood hills, Pacific sunset'),
  C('LAS', 'Las Vegas', 'USA', 36.1699, -115.1398, 'America/Los_Angeles', 'USD', 'the Strip blazing with light in the Mojave desert'),
  C('DEN', 'Denver', 'USA', 39.7392, -104.9903, 'America/Denver', 'USD', 'Rocky Mountains front range above the city'),
  C('CHI', 'Chicago', 'USA', 41.8781, -87.6298, 'America/Chicago', 'USD', 'lakefront skyscrapers on Lake Michigan'),
  C('YTO', 'Toronto', 'Canada', 43.6532, -79.3832, 'America/Toronto', 'CAD', 'CN Tower on the Lake Ontario shore'),
  C('YUL', 'Montréal', 'Canada', 45.5019, -73.5674, 'America/Toronto', 'CAD', 'Old Port and Mount Royal', 'Montreal'),
  C('NYC', 'New York', 'USA', 40.7128, -74.006, 'America/New_York', 'USD', 'Manhattan skyline, Empire State Building', 'New York City'),
  C('MIA', 'Miami', 'USA', 25.7617, -80.1918, 'America/New_York', 'USD', 'art deco South Beach and turquoise bay'),
  C('HAV', 'Havana', 'Cuba', 23.1136, -82.3666, 'America/Havana', 'CUP', 'the Malecón seawall and pastel colonial facades'),
  C('MEX', 'Mexico City', 'Mexico', 19.4326, -99.1332, 'America/Mexico_City', 'MXN', 'Zócalo cathedral with volcanoes on the horizon'),
  C('CUN', 'Cancún', 'Mexico', 21.1619, -86.8515, 'America/Cancun', 'MXN', 'Caribbean reefs and Mayan ruins of Tulum'),
  C('BOG', 'Bogotá', 'Colombia', 4.711, -74.0721, 'America/Bogota', 'COP', 'Andean plateau city beneath Monserrate'),
  C('CTG', 'Cartagena', 'Colombia', 10.391, -75.4794, 'America/Bogota', 'COP', 'walled colonial city on the Caribbean', 'Cartagena, Colombia'),
  C('LIM', 'Lima', 'Peru', -12.0464, -77.0428, 'America/Lima', 'PEN', 'Miraflores cliffs over the Pacific'),
  C('CUZ', 'Cusco', 'Peru', -13.532, -71.9675, 'America/Lima', 'PEN', 'Machu Picchu terraces under Andean peaks'),
  C('SCL', 'Santiago', 'Chile', -33.4489, -70.6693, 'America/Santiago', 'CLP', 'city lights below the snow-capped Andes'),
  C('BUE', 'Buenos Aires', 'Argentina', -34.6037, -58.3816, 'America/Argentina/Buenos_Aires', 'ARS', 'Obelisco and wide avenues'),
  C('USH', 'Ushuaia', 'Argentina', -54.8019, -68.303, 'America/Argentina/Ushuaia', 'ARS', 'Beagle Channel at the end of the world'),
  C('RIO', 'Rio de Janeiro', 'Brazil', -22.9068, -43.1729, 'America/Sao_Paulo', 'BRL', 'Christ the Redeemer above Sugarloaf and Copacabana'),
  C('SAO', 'São Paulo', 'Brazil', -23.5505, -46.6333, 'America/Sao_Paulo', 'BRL', 'endless skyscraper canopy under stormy skies'),
  // More waypoints
  C('TOS', 'Tromsø', 'Norway', 69.6492, 18.9553, 'Europe/Oslo', 'NOK', 'Arctic fjords under the aurora, the Arctic Cathedral and snowy peaks'),
  C('LOF', 'Lofoten', 'Norway', 68.2342, 14.5683, 'Europe/Oslo', 'NOK', 'red fishing cabins beneath jagged Arctic peaks'),
  C('BUD', 'Budapest', 'Hungary', 47.4979, 19.0402, 'Europe/Budapest', 'HUF', 'the Parliament on the Danube and the Chain Bridge at dusk'),
  C('KRK', 'Kraków', 'Poland', 50.0647, 19.945, 'Europe/Warsaw', 'PLN', 'the Main Market Square and Wawel Castle'),
  C('DBV', 'Dubrovnik', 'Croatia', 42.6507, 18.0944, 'Europe/Zagreb', 'EUR', 'walled old town with terracotta roofs on the Adriatic'),
  C('FLR', 'Florence', 'Italy', 43.7696, 11.2558, 'Europe/Rome', 'EUR', 'the Duomo dome over terracotta rooftops and the Arno'),
  C('AMF', 'Amalfi Coast', 'Italy', 40.634, 14.6027, 'Europe/Rome', 'EUR', 'cliffside pastel villages above the Tyrrhenian Sea'),
  C('NCE', 'Nice', 'France', 43.7102, 7.262, 'Europe/Paris', 'EUR', 'the Promenade des Anglais curving around the azure bay'),
  C('MLA', 'Valletta', 'Malta', 35.8989, 14.5146, 'Europe/Malta', 'EUR', 'honey-coloured fortress city over the Grand Harbour'),
  C('FAO', 'Algarve', 'Portugal', 37.0194, -7.9322, 'Europe/Lisbon', 'EUR', 'golden sea cliffs and grottoes of Ponta da Piedade'),
  C('JRO', 'Kilimanjaro', 'Tanzania', -3.0674, 37.3556, 'Africa/Dar_es_Salaam', 'TZS', 'snowcapped Kilimanjaro above the savannah', 'Mount Kilimanjaro'),
  C('VFA', 'Victoria Falls', 'Zimbabwe', -17.9243, 25.8572, 'Africa/Harare', 'USD', 'a thundering curtain of water wrapped in rainbow mist'),
  C('WDH', 'Namib Desert', 'Namibia', -24.7275, 15.3419, 'Africa/Windhoek', 'NAD', 'towering red dunes of Sossusvlei and dead camel-thorn trees', 'Sossusvlei'),
  C('GOI', 'Goa', 'India', 15.2993, 74.124, 'Asia/Kolkata', 'INR', 'palm-fringed beaches and whitewashed Portuguese churches'),
  C('JAI', 'Jaipur', 'India', 26.9124, 75.7873, 'Asia/Kolkata', 'INR', 'pink sandstone palaces and the Hawa Mahal'),
  C('HKT', 'Phuket', 'Thailand', 7.8804, 98.3923, 'Asia/Bangkok', 'THB', 'limestone islands rising from the turquoise Andaman Sea'),
  C('CTS', 'Sapporo', 'Japan', 43.0618, 141.3545, 'Asia/Tokyo', 'JPY', 'snow festival lanterns and Hokkaido mountains'),
  C('OKA', 'Okinawa', 'Japan', 26.2124, 127.6809, 'Asia/Tokyo', 'JPY', 'coral reefs and subtropical white-sand beaches', 'Okinawa Island'),
  C('AYQ', 'Uluru', 'Australia', -25.3444, 131.0369, 'Australia/Darwin', 'AUD', 'the red monolith glowing at sunset in the outback'),
  C('NAN', 'Fiji', 'Fiji', -17.7765, 177.4356, 'Pacific/Fiji', 'FJD', 'palm islands in a turquoise lagoon'),
  C('YBA', 'Banff', 'Canada', 51.1784, -115.5708, 'America/Edmonton', 'CAD', 'turquoise glacial lakes beneath the Canadian Rockies', 'Banff, Alberta'),
  C('GCN', 'Grand Canyon', 'USA', 36.0544, -112.1401, 'America/Phoenix', 'USD', 'layered red canyon walls at sunset'),
  C('MSY', 'New Orleans', 'USA', 29.9511, -90.0715, 'America/Chicago', 'USD', 'French Quarter balconies and jazz-lit streets'),
  C('PTY', 'Panama City', 'Panama', 8.9824, -79.5199, 'America/Panama', 'USD', 'a glass skyline along the Pacific bay'),
  C('SJO', 'Costa Rica', 'Costa Rica', 9.9281, -84.0907, 'America/Costa_Rica', 'CRC', 'misty cloud forest and smoking volcanoes'),
  C('GPS', 'Galápagos', 'Ecuador', -0.9538, -90.9656, 'Pacific/Galapagos', 'USD', 'volcanic islands with sea lions and marine iguanas', 'Galápagos Islands'),
  C('FTE', 'Patagonia', 'Argentina', -50.3379, -72.2648, 'America/Argentina/Rio_Gallegos', 'ARS', 'the Perito Moreno glacier and granite spires of Fitz Roy', 'Perito Moreno Glacier'),
  C('IPC', 'Easter Island', 'Chile', -27.1127, -109.3497, 'Pacific/Easter', 'CLP', 'moai statues on grassy volcanic slopes'),
];

export const CITY = Object.fromEntries(CITIES.map((c) => [c.code, c]));

// Pick a sensible default home from the browser's time zone.
export function guessHome() {
  let tz = '';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch { /* ignore */ }
  const exact = CITIES.find((c) => c.tz === tz);
  if (exact) return exact.code;
  const region = tz.split('/')[0];
  const offset = -new Date().getTimezoneOffset();
  const sameOffset = CITIES.find((c) => c.tz.startsWith(region) && tzOffsetMinutes(c.tz) === offset);
  return sameOffset?.code || 'LON';
}

export function tzOffsetMinutes(tz, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date);
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((asUtc - date.getTime()) / 60000);
  } catch {
    return 0;
  }
}
