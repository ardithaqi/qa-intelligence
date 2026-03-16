import "dotenv/config";
import { analyzeLatestFailure } from "./failureAnalyzer";

export async function runAnalyzer() {
    const result = await analyzeLatestFailure();
    return result;
}