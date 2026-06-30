/**
 * City / region / country / postal bundles for coherent synthetic addresses worldwide.
 */

export type WorldLocationSlot = {
  country: string;
  city: string;
  region: string;
  postal: string;
};

export const WORLD_LOCATION_SLOTS: readonly WorldLocationSlot[] = [
  // India (strong representation)
  { country: "India", city: "Mumbai", region: "Maharashtra", postal: "400051" },
  { country: "India", city: "Delhi", region: "Delhi", postal: "110001" },
  { country: "India", city: "Bengaluru", region: "Karnataka", postal: "560001" },
  { country: "India", city: "Hyderabad", region: "Telangana", postal: "500001" },
  { country: "India", city: "Chennai", region: "Tamil Nadu", postal: "600004" },
  { country: "India", city: "Kolkata", region: "West Bengal", postal: "700001" },
  { country: "India", city: "Pune", region: "Maharashtra", postal: "411001" },
  { country: "India", city: "Ahmedabad", region: "Gujarat", postal: "380001" },
  { country: "India", city: "Jaipur", region: "Rajasthan", postal: "302001" },
  { country: "India", city: "Surat", region: "Gujarat", postal: "395007" },
  { country: "India", city: "Lucknow", region: "Uttar Pradesh", postal: "226001" },
  { country: "India", city: "Kochi", region: "Kerala", postal: "682001" },
  { country: "India", city: "Indore", region: "Madhya Pradesh", postal: "452001" },
  { country: "India", city: "Chandigarh", region: "Chandigarh", postal: "160017" },
  // South Asia & nearby
  { country: "Pakistan", city: "Karachi", region: "Sindh", postal: "75500" },
  { country: "Bangladesh", city: "Dhaka", region: "Dhaka Division", postal: "1212" },
  { country: "Sri Lanka", city: "Colombo", region: "Western Province", postal: "00300" },
  { country: "Nepal", city: "Kathmandu", region: "Bagmati", postal: "44600" },
  { country: "United Arab Emirates", city: "Dubai", region: "Dubai", postal: "00000" },
  { country: "Singapore", city: "Singapore", region: "Singapore", postal: "018956" },
  // Americas
  { country: "United States", city: "Seattle", region: "WA", postal: "98101" },
  { country: "United States", city: "Chicago", region: "IL", postal: "60601" },
  { country: "United States", city: "Miami", region: "FL", postal: "33101" },
  { country: "United States", city: "Denver", region: "CO", postal: "80202" },
  { country: "Canada", city: "Toronto", region: "ON", postal: "M5H 2N2" },
  { country: "Canada", city: "Vancouver", region: "BC", postal: "V6B 1A1" },
  { country: "Mexico", city: "Mexico City", region: "CDMX", postal: "06000" },
  { country: "Brazil", city: "São Paulo", region: "SP", postal: "01310-100" },
  { country: "Argentina", city: "Buenos Aires", region: "CABA", postal: "C1002" },
  { country: "Colombia", city: "Bogotá", region: "Cundinamarca", postal: "110111" },
  // Europe
  { country: "United Kingdom", city: "London", region: "England", postal: "SW1A 1AA" },
  { country: "United Kingdom", city: "Manchester", region: "England", postal: "M1 1AE" },
  { country: "Germany", city: "Berlin", region: "Berlin", postal: "10115" },
  { country: "France", city: "Paris", region: "Île-de-France", postal: "75001" },
  { country: "Spain", city: "Madrid", region: "Madrid", postal: "28013" },
  { country: "Italy", city: "Milan", region: "Lombardy", postal: "20121" },
  { country: "Netherlands", city: "Amsterdam", region: "North Holland", postal: "1012 JS" },
  { country: "Poland", city: "Warsaw", region: "Masovia", postal: "00-001" },
  { country: "Sweden", city: "Stockholm", region: "Stockholm County", postal: "111 22" },
  { country: "Nigeria", city: "Lagos", region: "Lagos", postal: "100001" },
  { country: "South Africa", city: "Johannesburg", region: "Gauteng", postal: "2000" },
  { country: "Kenya", city: "Nairobi", region: "Nairobi County", postal: "00100" },
  { country: "Egypt", city: "Cairo", region: "Cairo Governorate", postal: "11511" },
  // East Asia & Pacific
  { country: "Japan", city: "Tokyo", region: "Tokyo", postal: "100-0001" },
  { country: "South Korea", city: "Seoul", region: "Seoul", postal: "04524" },
  { country: "China", city: "Shanghai", region: "Shanghai", postal: "200001" },
  { country: "Australia", city: "Sydney", region: "NSW", postal: "2000" },
  { country: "Australia", city: "Melbourne", region: "VIC", postal: "3000" },
  { country: "New Zealand", city: "Auckland", region: "Auckland", postal: "1010" },
  { country: "Philippines", city: "Manila", region: "Metro Manila", postal: "1000" },
  { country: "Indonesia", city: "Jakarta", region: "Jakarta", postal: "10110" },
  { country: "Thailand", city: "Bangkok", region: "Bangkok", postal: "10200" },
  { country: "Vietnam", city: "Ho Chi Minh City", region: "Ho Chi Minh", postal: "700000" },
  { country: "Malaysia", city: "Kuala Lumpur", region: "Federal Territory", postal: "50088" },
];

export const INTERNATIONAL_STREETS: readonly string[] = [
  "Main St",
  "Oak Ave",
  "Park Rd",
  "MG Road",
  "Brigade Rd",
  "Ring Rd",
  "Marine Drive",
  "Salt Lake Bypass",
  "Connaught Place",
  "Anna Salai",
  "Baner Rd",
  "FC Rd",
  "Residency Rd",
  "Banjara Hills Rd",
  "JVLR",
  "Camac St",
  "Esplanade Row",
  "Church St",
  "Koramangala Industrial Layout",
  "Oxford St",
  "Rue de Rivoli",
  "Gran Vía",
  "Schönhauser Allee",
  "Orchard Rd",
  "Nanjing Rd",
  "Shibuya Crossing",
  "Paulista Ave",
  "Robson St",
  "George St",
];
