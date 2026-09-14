// Exact v210/c9d6431c incident only. No arguments: read-only preflight.
// --execute: one provider refresh/GetUser proof, private evidence, then STORE.
// --resume-store / --resume-store-management: STORE existing proof only.
import {pathToFileURL} from "node:url";
import {main as runIncident} from "./ebay-exact-listing-read-refresh.mjs";

export const main=(argv=process.argv.slice(2),options={})=>runIncident(argv,{...options,incidentKey:"v210"});

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{
    const message=error instanceof Error?error.message:"";
    console.error(/^EBAY_EXACT_[A-Z0-9_]+$/.test(message)?message:"EBAY_EXACT_READ_REFRESH_FAILED_NO_SECRET_OUTPUT");
    process.exitCode=1;
  });
}
