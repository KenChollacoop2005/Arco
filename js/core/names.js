import { makeRng } from './rng.js';

// Given names, family names (none that change with gender) and order per tradition
export const NAME_POOLS = [
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
  { given: ['Aleksandra', 'Piotr', 'Zofia', 'Tomasz', 'Katarzyna', 'Marek', 'Agnieszka', 'Pawel'], family: ['Nowak', 'Wojcik', 'Mazur', 'Krawczyk', 'Kaczmarek', 'Zajac'] },
  { given: ['Ingrid', 'Lars', 'Astrid', 'Henrik', 'Sigrid', 'Magnus', 'Freja', 'Nils'], family: ['Andersen', 'Lindqvist', 'Berg', 'Haugen', 'Nilsson', 'Dahl'] },
  { given: ['Siobhan', 'Ciaran', 'Aoife', 'Declan', 'Niamh', 'Eoin', 'Roisin', 'Padraig'], family: ['Murphy', 'Byrne', 'Kelly', 'Doyle', 'Gallagher', 'Walsh'] },
  { given: ['Giulia', 'Marco', 'Chiara', 'Luca', 'Francesca', 'Matteo', 'Elena', 'Davide'], family: ['Rossi', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino'] },
  { given: ['Aiyana', 'Takoda', 'Winona', 'Ahanu', 'Kimimela', 'Hoka', 'Nita', 'Elan'], family: ['Begay', 'Yazzie', 'Tsosie', 'Benally', 'Etsitty', 'Nez'] },
  { given: ['Tendai', 'Rudo', 'Farai', 'Chipo', 'Tatenda', 'Nyasha', 'Kuda', 'Tsitsi'], family: ['Moyo', 'Ncube', 'Dube', 'Sibanda', 'Mpofu', 'Chikore'] },
  { given: ['Nino', 'Giorgi', 'Tamar', 'Levan', 'Salome', 'Davit', 'Mariam', 'Irakli'], family: ['Beridze', 'Kapanadze', 'Gelashvili', 'Lomidze', 'Tsiklauri', 'Abashidze'] },
  { given: ['Kalani', 'Keoni', 'Noelani', 'Makoa', 'Iolana', 'Kekoa', 'Pualani', 'Kai'], family: ['Kahale', 'Kealoha', 'Akana', 'Kamaka', 'Nakoa', 'Palakiko'] },
  { given: ['Hamid', 'Fatima', 'Bilal', 'Ayesha', 'Imran', 'Sana', 'Faisal', 'Zainab'], family: ['Qureshi', 'Malik', 'Chaudhry', 'Siddiqui', 'Butt', 'Rana'] },
];

// Seeded full name; pool picked first so names stay within one tradition
export function residentName(seed) {
  const rng = makeRng(seed >>> 0);
  const pool = rng.pick(NAME_POOLS);
  const given = rng.pick(pool.given);
  const family = rng.pick(pool.family);
  return pool.familyFirst ? `${family} ${given}` : `${given} ${family}`;
}
