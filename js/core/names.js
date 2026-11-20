import { makeRng } from './rng.js';

export const NAME_COMMON_SHARE = 0.67; // share of common English and European names
export const NAME_EGG_CHANCE = 0.02; // share of easter egg first names
export const NAME_EGGS = ['Ken', 'Oli', 'Marvin', 'Izzy', 'Kin']; // first names with no surname
const NAME_TRIES = 40; // rerolls before a repeated surname is allowed

// Common English and European first and last names, mixed freely
export const COMMON_FIRST = [
  'John', 'Emily', 'James', 'Sarah', 'Michael', 'Laura', 'David', 'Emma', 'Robert', 'Olivia', 'William', 'Sophie', 'Thomas', 'Hannah', 'Daniel',
  'Grace', 'Matthew', 'Alice', 'Andrew', 'Charlotte', 'Peter', 'Lucy', 'Paul', 'Amy', 'Mark', 'Rachel', 'Richard', 'Claire', 'Simon', 'Helen',
  'Stephen', 'Kate', 'George', 'Anna', 'Henry', 'Ellen', 'Jack', 'Ruby', 'Oliver', 'Chloe', 'Samuel', 'Megan', 'Benjamin', 'Holly', 'Edward', 'Isla',
  'Harry', 'Rose', 'Joseph', 'Jessica', 'Luke', 'Eleanor', 'Adam', 'Martha', 'Owen', 'Freya', 'Lewis', 'Molly', 'Ryan', 'Abigail', 'Callum',
  'Natalie', 'Jacob', 'Victoria', 'Nathan', 'Fiona', 'Aidan', 'Leah', 'Patrick', 'Bethany', 'Sean', 'Harriet', 'Liam', 'Imogen', 'Connor', 'Phoebe',
  'Alexander', 'Daisy', 'Christopher', 'Lily', 'Anthony', 'Amelia', 'Martin', 'Isabel', 'Frank', 'Margaret', 'Hugo', 'Clara', 'Felix', 'Ines',
  'Louis', 'Camille', 'Pierre', 'Margot', 'Julien', 'Elise', 'Antoine', 'Manon', 'Lukas', 'Lena', 'Jonas', 'Mia', 'Felipe', 'Carmen', 'Pablo',
  'Elena', 'Lorenzo', 'Chiara', 'Marco', 'Giulia', 'Nils', 'Ingrid', 'Lars', 'Astrid', 'Erik', 'Sigrid', 'Piotr', 'Zofia', 'Tomasz', 'Agnieszka',
  'Jan', 'Eva', 'Pieter', 'Femke', 'Ciaran', 'Aoife', 'Declan', 'Niamh', 'Rory', 'Maeve', 'Finn', 'Ida', 'Anton', 'Klara', 'Mateo', 'Lucia',
  'Dominik', 'Petra', 'Viktor', 'Alma',
];
export const COMMON_LAST = [
  'Carter', 'Brooks', 'Smith', 'Johnson', 'Brown', 'Taylor', 'Wilson', 'Davies', 'Evans', 'Thomas', 'Roberts', 'Walker', 'Wright', 'Thompson',
  'White', 'Hughes', 'Edwards', 'Green', 'Hall', 'Wood', 'Harris', 'Clarke', 'Jackson', 'Turner', 'Hill', 'Moore', 'Cooper', 'Ward', 'Morris',
  'King', 'Baker', 'Harrison', 'Morgan', 'Allen', 'Parker', 'Price', 'Bennett', 'Young', 'Griffiths', 'Mitchell', 'Kelly', 'Cook', 'Bailey', 'Bell',
  'Collins', 'Murphy', 'Richardson', 'Cox', 'Howard', 'Marshall', 'Graham', 'Stewart', 'Fisher', 'Shaw', 'Hunt', 'Mills', 'Palmer', 'Webb', 'Lloyd',
  'Ellis', 'Reed', 'Barnes', 'Fletcher', 'Holmes', 'Gray', 'Hayes', 'Spencer', 'Gibson', 'Porter', 'Hunter', 'Knight', 'Grant', 'Murray', 'Campbell',
  'Byrne', 'Walsh', 'Doyle', 'Gallagher', 'Quinn', 'Brennan', 'Fraser', 'Duncan', 'Reid', 'Martin', 'Bernard', 'Dubois', 'Moreau', 'Laurent',
  'Lefevre', 'Fontaine', 'Girard', 'Muller', 'Schmidt', 'Weber', 'Wagner', 'Becker', 'Hoffmann', 'Koch', 'Richter', 'Rossi', 'Bianchi', 'Romano',
  'Colombo', 'Ricci', 'Marino', 'Greco', 'Conti', 'Garcia', 'Fernandez', 'Lopez', 'Martinez', 'Navarro', 'Romero', 'Ruiz', 'Iglesias', 'Jansen',
  'Visser', 'Bakker', 'Smit', 'Meijer', 'Mulder', 'Andersen', 'Lindqvist', 'Berg', 'Haugen', 'Nilsson', 'Dahl', 'Larsen', 'Nowak', 'Wojcik', 'Mazur',
  'Krawczyk', 'Kowalski', 'Novak', 'Horvat', 'Svoboda', 'Dvorak', 'Kovacs', 'Toth', 'Varga', 'Popescu', 'Ionescu', 'Papadopoulos', 'Nikolaidis',
];

// Wider mix: given names, family names (none that change with gender) and order per tradition
export const WORLD_POOLS = [
  { given: ['Amara', 'Chidi', 'Ngozi', 'Emeka', 'Ifeoma', 'Tunde', 'Folake', 'Obinna'], family: ['Okafor', 'Adeyemi', 'Eze', 'Balogun', 'Nwosu', 'Okonkwo'] },
  { given: ['Wanjiru', 'Kamau', 'Achieng', 'Otieno', 'Njeri', 'Baraka', 'Zawadi', 'Mwangi'], family: ['Mutua', 'Odhiambo', 'Kariuki', 'Wekesa', 'Chege', 'Owino'] },
  { given: ['Wei', 'Mei', 'Jian', 'Lan', 'Hao', 'Xiu', 'Bo', 'Ying'], family: ['Chen', 'Liu', 'Zhang', 'Huang', 'Zhou', 'Wu'], familyFirst: true },
  { given: ['Haruto', 'Yui', 'Sota', 'Aoi', 'Ren', 'Hina', 'Kaito', 'Mio'], family: ['Sato', 'Tanaka', 'Watanabe', 'Ito', 'Nakamura', 'Kobayashi'], familyFirst: true },
  { given: ['Minjun', 'Seoyeon', 'Jiho', 'Haeun', 'Doyun', 'Jiwoo', 'Yejun', 'Sua'], family: ['Kim', 'Park', 'Choi', 'Jung', 'Kang', 'Yoon'], familyFirst: true },
  { given: ['Linh', 'Minh', 'Thao', 'Duc', 'Hoa', 'Quang', 'Mai', 'Tuan'], family: ['Nguyen', 'Tran', 'Le', 'Pham', 'Vu', 'Dang'], familyFirst: true },
  { given: ['Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Kavya', 'Arjun', 'Meera'], family: ['Sharma', 'Patel', 'Iyer', 'Reddy', 'Nair', 'Gupta'] },
  { given: ['Omar', 'Layla', 'Karim', 'Nour', 'Yusuf', 'Rania', 'Samir', 'Huda'], family: ['Haddad', 'Khalil', 'Nasser', 'Mansour', 'Saleh', 'Farah'] },
  { given: ['Dariush', 'Shirin', 'Kian', 'Parisa', 'Arash', 'Mina', 'Babak', 'Leila'], family: ['Tehrani', 'Rahimi', 'Karimi', 'Hosseini', 'Moradi', 'Ahmadi'] },
  { given: ['Elif', 'Emre', 'Zeynep', 'Mert', 'Ayse', 'Burak', 'Defne', 'Can'], family: ['Yilmaz', 'Kaya', 'Demir', 'Sahin', 'Celik', 'Aydin'] },
  { given: ['Sofia', 'Mateo', 'Valentina', 'Santiago', 'Camila', 'Diego', 'Lucia', 'Javier'], family: ['Garcia', 'Rodriguez', 'Morales', 'Herrera', 'Castillo', 'Ortega'] },
  { given: ['Joao', 'Beatriz', 'Thiago', 'Larissa', 'Rafael', 'Mariana', 'Caio', 'Luana'], family: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Costa', 'Pereira'] },
  { given: ['Malia', 'Sione', 'Leilani', 'Tavita', 'Mele', 'Tevita', 'Ana', 'Losa'], family: ['Tupou', 'Fifita', 'Taufa', 'Vaipulu', 'Havili', 'Latu'] },
  { given: ['Aiyana', 'Takoda', 'Winona', 'Ahanu', 'Kimimela', 'Hoka', 'Nita', 'Elan'], family: ['Begay', 'Yazzie', 'Tsosie', 'Benally', 'Etsitty', 'Nez'] },
  { given: ['Tendai', 'Rudo', 'Farai', 'Chipo', 'Tatenda', 'Nyasha', 'Kuda', 'Tsitsi'], family: ['Moyo', 'Ncube', 'Dube', 'Sibanda', 'Mpofu', 'Chikore'] },
  { given: ['Nino', 'Giorgi', 'Tamar', 'Levan', 'Salome', 'Davit', 'Mariam', 'Irakli'], family: ['Beridze', 'Kapanadze', 'Gelashvili', 'Lomidze', 'Tsiklauri', 'Abashidze'] },
  { given: ['Kalani', 'Keoni', 'Noelani', 'Makoa', 'Iolana', 'Kekoa', 'Pualani', 'Kai'], family: ['Kahale', 'Kealoha', 'Akana', 'Kamaka', 'Nakoa', 'Palakiko'] },
  { given: ['Hamid', 'Fatima', 'Bilal', 'Ayesha', 'Imran', 'Sana', 'Faisal', 'Zainab'], family: ['Qureshi', 'Malik', 'Chaudhry', 'Siddiqui', 'Butt', 'Rana'] },
];

const ALL_LAST = new Set([...COMMON_LAST, ...WORLD_POOLS.flatMap((pool) => pool.family)]);

// Surname of a name from these pools, or null for an easter egg
export function surnameOf(name) {
  const parts = name.split(' ');
  if (parts.length < 2) return null;
  return ALL_LAST.has(parts[parts.length - 1]) ? parts[parts.length - 1] : parts[0];
}

// One seeded try: an easter egg, a common name or one tradition's name
function rollName(rng, eggAllowed) {
  if (eggAllowed && rng.chance(NAME_EGG_CHANCE)) return rng.pick(NAME_EGGS);
  if (rng.chance(NAME_COMMON_SHARE)) return `${rng.pick(COMMON_FIRST)} ${rng.pick(COMMON_LAST)}`;
  const pool = rng.pick(WORLD_POOLS);
  const given = rng.pick(pool.given);
  const family = rng.pick(pool.family);
  return pool.familyFirst ? `${family} ${given}` : `${given} ${family}`;
}

// Seeded full name; taken lists the other names in the same puzzle (no repeated surname, one egg at most)
export function residentName(seed, taken = []) {
  const rng = makeRng(seed >>> 0);
  const surnames = new Set(taken.map(surnameOf).filter(Boolean));
  const eggAllowed = !taken.some((name) => NAME_EGGS.includes(name));
  let name = rollName(rng, eggAllowed);
  for (let attempt = 0; attempt < NAME_TRIES && surnames.has(surnameOf(name)); attempt++) name = rollName(rng, eggAllowed);
  return name;
}
