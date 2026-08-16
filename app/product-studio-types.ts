export type StudioMode = "cli";

export type DetailSection = {
  type: "benefit" | "story" | "howto" | "proof" | "spec" | "caution";
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
};
export type ProductStudioResult = {
  mode: StudioMode;
  product: {
    name: string;
    category: string;
    oneLine: string;
    targetCustomer: string;
    features: string[];
    cautions: string[];
  };
  design: {
    themeName: string;
    palette: {
      primary: string;
      accent: string;
      surface: string;
      text: string;
    };
    heroCopy: string;
    heroSubcopy: string;
    cta: string;
    sections: DetailSection[];
  };
  thumbnail: {
    headline: string;
    subline: string;
    badge: string;
  };
  warnings: string[];
};
