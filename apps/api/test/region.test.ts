import { describe, expect, it } from "vitest";
import { languageOfScript, localLanguageAt, stateAt } from "../src/geo/region.js";

const at = (lat: number, lon: number) => stateAt({ lat, lon })?.name ?? null;

describe("stateAt", () => {
  it("places cities in Telangana", () => {
    expect(at(17.3850, 78.4867)).toBe("Telangana"); // Hyderabad
    expect(at(17.4314, 78.3822)).toBe("Telangana"); // Knowledge City
    expect(at(17.9689, 79.5941)).toBe("Telangana"); // Warangal
    expect(at(18.6725, 78.0941)).toBe("Telangana"); // Nizamabad
    expect(at(17.2473, 80.1514)).toBe("Telangana"); // Khammam
    expect(at(19.6641, 78.5320)).toBe("Telangana"); // Adilabad
  });

  it("places cities in Andhra Pradesh", () => {
    expect(at(16.5062, 80.6480)).toBe("Andhra Pradesh"); // Vijayawada
    expect(at(17.6868, 83.2185)).toBe("Andhra Pradesh"); // Visakhapatnam
    expect(at(13.6288, 79.4192)).toBe("Andhra Pradesh"); // Tirupati
    expect(at(15.8281, 78.0373)).toBe("Andhra Pradesh"); // Kurnool
    expect(at(14.6819, 77.6006)).toBe("Andhra Pradesh"); // Anantapur
    expect(at(14.4426, 79.9865)).toBe("Andhra Pradesh"); // Nellore
    expect(at(18.2949, 83.8938)).toBe("Andhra Pradesh"); // Srikakulam
    expect(at(15.6261, 77.2749)).toBe("Andhra Pradesh"); // Adoni
  });

  it("places cities in Karnataka", () => {
    expect(at(12.9716, 77.5946)).toBe("Karnataka"); // Bengaluru
    expect(at(12.2958, 76.6394)).toBe("Karnataka"); // Mysuru
    expect(at(12.9141, 74.8560)).toBe("Karnataka"); // Mangaluru
    expect(at(15.3647, 75.1240)).toBe("Karnataka"); // Hubballi
    expect(at(15.8497, 74.4977)).toBe("Karnataka"); // Belagavi
    expect(at(15.1394, 76.9214)).toBe("Karnataka"); // Ballari
    expect(at(17.3297, 76.8343)).toBe("Karnataka"); // Kalaburagi
    expect(at(17.9104, 77.5199)).toBe("Karnataka"); // Bidar
    expect(at(12.9551, 78.2702)).toBe("Karnataka"); // KGF
    expect(at(16.2076, 77.3463)).toBe("Karnataka"); // Raichur
    expect(at(12.7107, 77.6964)).toBe("Karnataka"); // Anekal
  });

  it("leaves other states out (Hindi only)", () => {
    expect(at(12.7409, 77.8253)).toBeNull(); // Hosur, Tamil Nadu
    expect(at(13.0827, 80.2707)).toBeNull(); // Chennai
    expect(at(19.0760, 72.8777)).toBeNull(); // Mumbai
    expect(at(18.5204, 73.8567)).toBeNull(); // Pune
    expect(at(17.6599, 75.9064)).toBeNull(); // Solapur
    expect(at(28.6139, 77.2090)).toBeNull(); // Delhi
    expect(at(15.4909, 73.8278)).toBeNull(); // Panaji, Goa
    expect(at(19.8135, 85.8312)).toBeNull(); // Puri, Odisha
  });
});

describe("local language", () => {
  it("is Telugu in Telangana and Andhra, Kannada in Karnataka, none elsewhere", () => {
    expect(localLanguageAt({ lat: 17.385, lon: 78.4867 })?.code).toBe("te");
    expect(localLanguageAt({ lat: 16.5062, lon: 80.648 })?.code).toBe("te");
    expect(localLanguageAt({ lat: 12.9716, lon: 77.5946 })?.code).toBe("kn");
    expect(localLanguageAt({ lat: 28.6139, lon: 77.209 })).toBeNull();
  });

  it("recognises a name's script", () => {
    expect(languageOfScript("నాలెడ్జ్ సిటీ")?.code).toBe("te");
    expect(languageOfScript("ಲಾಫ್ಟ್")?.code).toBe("kn");
    expect(languageOfScript("नॉलेज सिटी")).toBeNull();
    expect(languageOfScript("Knowledge City")).toBeNull();
  });
});
