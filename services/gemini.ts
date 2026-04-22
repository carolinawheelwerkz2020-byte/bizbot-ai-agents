export type GeminiServiceConfig = {
  model: string;
};

export function getGeminiServiceConfig(): GeminiServiceConfig {
  return {
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  };
}
