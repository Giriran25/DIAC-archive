/* Retrieval corpus for the DAIC archive assistant.
   Server-side only — it is never shipped to the browser.
   In a real deployment this would be a vector DB (FAISS/Chroma) with
   embeddings of the full 32-volume Writings and Speeches, the
   Constituent Assembly Debates, and OCRd manuscripts. */
export const CORPUS = `
[SOURCE: Writings and Speeches Vol. I — "Annihilation of Caste" (1936, undelivered)]
Caste is not merely a division of labour; it is a division of labourers. The caste system does not demarcate racial division. The caste system is a social division of people of the same race. The out-caste is a bye-product of the caste system. There will be outcastes as long as there are castes. Nothing can emancipate the outcaste except the destruction of the caste system.

[SOURCE: Writings and Speeches Vol. X, pp. 212–218 — Labour Member's minutes (1942–46)]
As Labour Member of the Viceroy's Executive Council, Ambedkar drafted the position that working hours must be limited by statute to 48 hours per week, with mandatory paid leave, health insurance, and dearness allowance. He framed rest not as a concession from the employer but as a precondition for a worker's dignity and productivity. He pushed for the establishment of employment exchanges and the Tripartite Labour Conference.

[SOURCE: Constituent Assembly Debates Vol. VII, 29 November 1948 — on Article 17 (then Draft Article 11)]
"Untouchability" is abolished and its practice in any form is forbidden. The enforcement of any disability arising out of "Untouchability" shall be an offence punishable in accordance with law. Ambedkar defended the plain, uncompromising wording against amendments seeking to soften it, arguing that any qualifying language would leave a loophole for continued social exclusion.

[SOURCE: Mahad Satyagraha Declaration (1927), handwritten manuscript, DAIC archive m-014]
The declaration at the Chavadar tank asserted the natural right of the depressed classes to draw water from public sources. Ambedkar led thousands of participants in a public act of drinking from the tank, followed by a ceremonial burning of the Manusmriti on 25 December 1927 to symbolise the rejection of the caste ideology it represented.

[SOURCE: Writings and Speeches Vol. XVII — "The Buddha and His Dhamma" (published 1957)]
Ambedkar reframes Buddhism as a rationalist, ethical social philosophy centred on suffering (dukkha) and its cessation through right conduct. He rejects supernatural elements and karmic determinism, presenting the Dhamma as a practical guide to a just society. This text was completed shortly before his death and became foundational to the Navayana Buddhist movement.

[SOURCE: Nagpur Deekshabhoomi Address (14 October 1956), audio fragment, DAIC archive s-089, timestamp 04:12–06:30]
Addressing an assembly of an estimated 400,000 followers, Ambedkar administered the 22 vows of conversion to Buddhism. He framed the conversion not as a rejection of India but as a return to an indigenous philosophical tradition free of caste.

[SOURCE: "States and Minorities" (1947), memorandum to the Constituent Assembly]
A detailed constitutional proposal for economic democracy, including the nationalisation of key industries, state ownership of agricultural land, and constitutional protection for religious and linguistic minorities. Many provisions foreshadowed the Directive Principles of State Policy.

[SOURCE: Constituent Assembly Debates Vol. XI, 25 November 1949 — closing address]
"Political democracy cannot last unless there lies at the base of it social democracy. What does social democracy mean? It means a way of life which recognises liberty, equality and fraternity as the principles of life."
`;
