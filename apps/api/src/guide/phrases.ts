import type { Language } from "../domain/types.js";

/** Everything Locus says, in Hinglish and English. Cue text is spoken as the recipient typed it. */
export const say = {
  notice: (l: Language) =>
    l === "hi"
      ? "Namaste, main ek AI assistant hoon, aur raasta batane ke liye yeh call transcribe ho rahi hai. Delivery kiske liye hai, aur kaunse app se?"
      : "Hi, this call is answered by an AI assistant and transcribed to help guide you. Who is this delivery for, and which app is it from?",
  screenAgain: (l: Language) =>
    l === "hi"
      ? "Ek baar phir bataiye: delivery kis naam par hai, aur kaunse app se?"
      : "Sorry, once more: whose name is the delivery under, and which app is it from?",
  askApp: (l: Language) =>
    l === "hi" ? "Aur order kaunse app se hai? Swiggy, Zomato, Amazon?" : "And which app is the order from? Swiggy, Zomato, Amazon?",
  askName: (l: Language) =>
    l === "hi" ? "Order kis naam par hai?" : "Whose name is the order under?",
  secondChance: (l: Language) =>
    l === "hi"
      ? "Raasta batane se pehle bas itna bataiye: order kis naam par hai, aur kaunse app se?"
      : "Before I give directions: whose name is the order under, and which app is it from?",
  takeMessage: (l: Language) =>
    l === "hi"
      ? "Main unhe message de dunga. Aap kya kehna chahenge?"
      : "I'll pass on a message. What would you like to say?",
  messageThanks: (l: Language) =>
    l === "hi" ? "Theek hai, message de diya jayega. Dhanyavaad." : "Okay, I'll pass that on. Thank you.",
  whereAreYou: (l: Language) =>
    l === "hi"
      ? "Aap abhi kahan hain? Aas paas koi dukaan ya landmark bataiye."
      : "Where are you right now? Tell me a shop or landmark you can see.",
  didntUnderstand: (l: Language) =>
    l === "hi"
      ? "Maaf kijiye, samajh nahi aaya. Aapko aas paas aur kya dikh raha hai?"
      : "Sorry, I couldn't place that. What else can you see around you?",
  connecting: (l: Language) =>
    l === "hi"
      ? "Main unhe call kar raha hoon, line par rahiye."
      : "I'm calling them now, please stay on the line.",
  connected: (l: Language) => (l === "hi" ? "Aapko jod raha hoon." : "Connecting you now."),
  notRecording: (l: Language) =>
    l === "hi" ? "Theek hai, ab se kuch record nahi hoga, aur ab tak ka bhi mita diya." : "Okay, nothing more is recorded, and what was is deleted.",
  fallback: (l: Language, note: string) =>
    l === "hi" ? `Woh abhi phone nahi utha paaye. Unhone yeh kaha hai: ${note}` : `They couldn't pick up. They left this note: ${note}`,
  arrived: (l: Language) =>
    l === "hi" ? "Bas, aap pahunch gaye. Shukriya!" : "That's the place, you've arrived. Thank you!",
  routeStep: (l: Language, street: string, landmark: string) =>
    l === "hi" ? `${street} se ${landmark} ki taraf aaiye.` : `Take ${street} towards ${landmark}.`,
  headTowards: (l: Language, landmark: string) =>
    l === "hi" ? `${landmark} ki taraf aaiye.` : `Head towards ${landmark}.`,
};

/** Rider objects to the AI notice or to being recorded. */
export const OBJECTION_PHRASES = [
  "record mat karo",
  "recording nahi",
  "recording band",
  "dont record",
  "do not record",
  "no recording",
  "not okay with recording",
  "ai nahi chahiye",
  "no ai",
];

/** Rider asks for a person instead of the assistant. */
export const PERSON_PHRASES = [
  "insaan se baat",
  "unse baat karao",
  "unse baat karwao",
  "customer se baat",
  "real person",
  "human",
  "talk to them",
  "call them",
];

/** Rider says the last instruction didn't work. */
export const WRONG_PHRASES = [
  "galat",
  "wrong",
  "nahi mil raha",
  "nahi mila",
  "aisa kuch nahi",
  "not there",
  "cant find",
  "can not find",
];

/** Rider says they've reached the door; only listened for once every landmark is behind them. */
export const ARRIVED_PHRASES = [
  "pahunch gaya",
  "pahunch gayi",
  "pahuch gaya",
  "aa gaya",
  "aa gayi",
  "gate pe hoon",
  "gate par hoon",
  "gate pe hu",
  "ghar ke saamne",
  "door pe",
  "reached",
  "i am here",
  "im here",
];

/**
 * Delivery apps and couriers a genuine rider may name. Screening accepts any of them
 * (with the recipient's first name): a recipient who orders from a new app, or a
 * courier delivering for one, mustn't lock the rider out.
 */
export const KNOWN_DELIVERY_NAMES = [
  "swiggy", "instamart", "zomato", "blinkit", "zepto", "amazon", "flipkart", "bigbasket", "big basket", "dunzo",
  "myntra", "meesho", "nykaa", "ajio", "jiomart", "tata neu", "uber eats", "porter", "rapido", "magicpin",
  // Not "Delhivery": speech-to-text writes it as "delivery", which nearly every rider says.
  "ekart", "e kart", "blue dart", "bluedart", "dtdc", "xpressbees", "shadowfax", "ecom express", "india post", "speed post",
];

/** Rider asking the way ("where do I come?"): not a message to pass on. */
export const DIRECTION_QUESTIONS = [
  "kidhar", "kidhar aana", "kahan aana", "kaha aana", "kahan aaun", "kaha aau", "kahan hai", "address", "location", "rasta", "raasta", "where",
];
