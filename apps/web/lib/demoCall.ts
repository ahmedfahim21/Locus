import type { LatLon, RouteLeg } from "./api";
import type { Stop } from "../components/RouteMap";

/**
 * A scripted demo call on a real Hebbal, Bengaluru route (geometry from OSRM over
 * OpenStreetMap). The dialogue matches /replay/wrong-gate.mp3. Landmark names are
 * sample data for the demo, not real businesses.
 */
const ROUTE: [number, number][] = [
  [77.592565, 13.035454],
  [77.592718, 13.036111],
  [77.592891, 13.036853],
  [77.592959, 13.036828],
  [77.59355, 13.036636],
  [77.593689, 13.036606],
  [77.59382, 13.036573],
  [77.594119, 13.036487],
  [77.59441, 13.036391],
  [77.594701, 13.036296],
  [77.595046, 13.036181],
  [77.595133, 13.036167],
  [77.595484, 13.036169],
  [77.595691, 13.036137],
  [77.595857, 13.036112],
  [77.59593, 13.036101],
  [77.59613, 13.036065],
  [77.596271, 13.036039],
  [77.596327, 13.036029],
  [77.596649, 13.035998],
  [77.596852, 13.035904],
  [77.596982, 13.035853],
  [77.597024, 13.035842],
  [77.597109, 13.035941],
  [77.597281, 13.036211],
  [77.59733, 13.036335],
  [77.597468, 13.036724],
  [77.597454, 13.03679],
  [77.597413, 13.03699],
  [77.597305, 13.037062],
  [77.59718, 13.037108],
  [77.596917, 13.037206],
  [77.596783, 13.037566],
  [77.596737, 13.03769],
  [77.59668, 13.037836],
  [77.596583, 13.038096],
  [77.59656, 13.038164],
  [77.596483, 13.038387],
  [77.596344, 13.038735],
  [77.596235, 13.039106],
  [77.596233, 13.039213],
  [77.596355, 13.039191],
  [77.597034, 13.039139],
  [77.597671, 13.039107],
  [77.597706, 13.039106],
  [77.598343, 13.039098],
  [77.598332, 13.03927],
  [77.598308, 13.039388],
  [77.598297, 13.039441],
  [77.59826, 13.039747],
  [77.598508, 13.039793],
  [77.59855, 13.039793],
  [77.599063, 13.039841],
];

const at = (i: number): LatLon => ({ lon: ROUTE[i]![0], lat: ROUTE[i]![1] });
const STOP_AT = [0, 14, 30] as const;
const DOOR_AT = ROUTE.length - 1;

export const demoStops: Stop[] = [
  { name: "Grey gate", kind: "gate", color: "#8d939b", alt: [{ text: "स्लेटी गेट", script: "deva" }, { text: "ಬೂದು ಗೇಟ್", script: "knda" }], location: at(STOP_AT[0]) },
  { name: "Milk shop", kind: "shop", color: "#2f7ed8", alt: [{ text: "दूध की दुकान", script: "deva" }, { text: "ಹಾಲಿನ ಅಂಗಡಿ", script: "knda" }], location: at(STOP_AT[1]) },
  { name: "Medical store", kind: "pharmacy", color: "#2fa56a", alt: [{ text: "मेडिकल स्टोर", script: "deva" }, { text: "ಮೆಡಿಕಲ್ ಸ್ಟೋರ್", script: "knda" }], location: at(STOP_AT[2]) },
];

export const demoDoor: LatLon = at(DOOR_AT);

const slice = (from: number, to: number): RouteLeg => ({ onRoads: true, line: ROUTE.slice(from, to + 1).map(([lon, lat]) => ({ lat, lon })) });
export const demoLegs: RouteLeg[] = [slice(STOP_AT[0], STOP_AT[1]), slice(STOP_AT[1], STOP_AT[2]), slice(STOP_AT[2], DOOR_AT)];

/** Street the rider is on at each stop (from the OSRM steps). */
export const demoStreets = ["5th Cross Road", "SS Ashram Road", "SS Ashram Road", "Vishwanatha Nagenhalli Main Road"];

export type DemoTurn = {
  /** Seconds into the audio where this line starts. */
  time: number;
  speaker: "rider" | "locus";
  text: string;
  /** Stops reached once this line is spoken. */
  reached: number;
  arrived?: boolean;
};

export const demoTurns: DemoTurn[] = [
  { time: 0, speaker: "rider", text: "Main bade grey gate par hoon. Gate band hai.", reached: 1 },
  { time: 3, speaker: "locus", text: "Kya paas mein koi dukaan ya board dikh raha hai?", reached: 1 },
  { time: 6, speaker: "rider", text: "Haan, doodh ki dukaan dikh rahi hai.", reached: 2 },
  { time: 9, speaker: "locus", text: "Medical tak aaiye. Uske bagal wali gali mein neela gate hai.", reached: 2 },
  { time: 13, speaker: "rider", text: "Haan, neele gate par pahunch gaya.", reached: 3, arrived: true },
];
